import fs from 'fs';
import path from 'path';
import express, { type RequestHandler, type Request, type Response } from 'express';

/**
 * The built client, laid out beside the compiled server exactly as it sits in
 * the repository. The Docker image mirrors that layout, so one path is correct
 * both in a container and in a local checkout.
 *
 * Three levels up, not two: this file lives at `middlewares/staticClient` under
 * `src` when ts-node or Jest loads it and under `dist` once compiled — the same
 * depth either way, but a level deeper than the package root. Getting it wrong
 * breaks nothing loudly; the app simply serves no client and answers every
 * navigation with a JSON 404.
 *
 * CLIENT_DIST overrides it, which is what the image sets rather than relying on
 * the arithmetic above.
 */
export const DEFAULT_CLIENT_DIST = process.env.CLIENT_DIST
    ? path.resolve(process.env.CLIENT_DIST)
    : path.resolve(__dirname, '../../../frontend/dist');

/**
 * Prefixes the API owns. A request to one of these never gets the SPA shell.
 *
 * Every router mounted in `app.ts` belongs here. `/plans` was mounted with the
 * plan library and left off this list, so a mistyped plan endpoint asked for
 * with `Accept: text/html` came back as the app's HTML instead of the 404 it
 * was. `/explore`, the library's page, is a client route and is not listed.
 */
export const API_PREFIXES = ['/auth', '/habits', '/plans', '/healthz'];

const isApiPath = (pathname: string): boolean =>
    API_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));

/**
 * HEAD as well as GET. Express maps HEAD onto GET *routes* by itself, but this
 * is a plain middleware doing its own method check, and health checkers, uptime
 * monitors and crawlers all probe with HEAD. Answering 404 to `HEAD /` while
 * `GET /` returns the app is how a healthy deployment gets taken out of
 * rotation — this is exactly what happened on the first real deploy.
 */
const NAVIGABLE_METHODS = new Set(['GET', 'HEAD']);

/**
 * Whether the caller is a browser navigating, rather than code fetching JSON.
 *
 * Deliberately stricter than `req.accepts('html')`: that treats a missing
 * Accept header as "anything", which would hand the HTML shell to every API
 * client that did not bother to ask for JSON — including the test suite, whose
 * results would then depend on whether a client build happened to be lying
 * around. Browsers always announce text/html when navigating; fetch and XHR
 * default to \*\/\*, so they keep getting the error envelope.
 */
const wantsHtml = (req: Request): boolean =>
    req.headers.accept?.includes('text/html') ?? false;

/**
 * index.html names every asset by content hash, so it is the one file that must
 * never be cached: a stale copy would keep pointing browsers at the previous
 * deploy's bundle, which no longer exists.
 */
const noStore = (res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
};

export interface ClientHandlers {
    /** False when no client build is present, as in development. */
    hasBuild: boolean;
    assets: RequestHandler;
    fallback: RequestHandler;
}

export const clientHandlers = (distDir: string = DEFAULT_CLIENT_DIST): ClientHandlers => {
    const indexHtml = path.join(distDir, 'index.html');
    const hashedDir = path.join(distDir, 'assets') + path.sep;

    return {
        hasBuild: fs.existsSync(indexHtml),

        /**
         * Only what Vite hashed may be cached for a year. Everything under
         * `assets/` is named by its content, so a new deploy is a new name and
         * a repeat visit fetches nothing but the document.
         *
         * Everything else keeps its name across deploys — the favicon, the
         * icons, the web manifest and above all the service worker — and a
         * year-long cache on those meant a changed icon never appeared and,
         * worse, a changed worker would never be picked up. Those are served
         * `no-cache`: kept, but checked with the server before each use.
         */
        assets: express.static(distDir, {
            // The document is the fallback's job; this serves the files beside it.
            index: false,
            maxAge: '1y',
            immutable: true,
            setHeaders: (res, filePath) => {
                if (filePath === indexHtml) {
                    noStore(res);
                } else if (!filePath.startsWith(hashedDir)) {
                    res.setHeader('Cache-Control', 'no-cache');
                }
            },
        }),

        /**
         * Client-side routes (/main, /profile, /stats) exist only in the
         * browser, so a hard refresh on one has to be answered with the shell.
         *
         * Anything under an API prefix is passed through untouched. Without
         * that check a mistyped endpoint would answer 200 with HTML, and the
         * client — which expects the JSON envelope — would report an unreadable
         * response instead of the 404 the server actually meant.
         */
        fallback: (req, res, next) => {
            if (!NAVIGABLE_METHODS.has(req.method) || isApiPath(req.path)) {
                return next();
            }

            // The site root is unambiguously the app's entry point: no API
            // route lives there and no JSON client asks for it. So it is served
            // whatever the caller claims to accept — health checkers and uptime
            // monitors send */* or no Accept header at all, and a live deploy
            // was briefly marked unhealthy over exactly this before the
            // exemption existed. Every other path still has to ask for HTML,
            // which is what keeps a wrong URL from reaching an API client as an
            // unreadable page.
            if (req.path !== '/' && !wantsHtml(req)) {
                return next();
            }

            noStore(res);
            res.sendFile(indexHtml, error => {
                if (error) {
                    next(error);
                }
            });
        },
    };
};
