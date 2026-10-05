import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import coachRoutes from "@routes/coachRouter";
import authRoutes from "@routes/authRoutes";
import habitRoutes from "@routes/habitRouter";
import healthRoutes from "@routes/healthRouter";
import journalRoutes from "@routes/journalRouter";
import planRoutes from "@routes/planRouter";
import { corsOptions } from "@config/cors";
import { logger } from "@config/logger";
import { apiLimiter } from "@middlewares/rateLimit";
import { csrfProtection } from "@middlewares/csrf";
import { errorHandler, notFoundHandler } from "@middlewares/errorHandler";
import { clientHandlers } from "@middlewares/staticClient";
// Imported for its side effect: applies mongoose-wide query hardening.
import "@config/mongoose";

/**
 * react-apple-emojis loads its artwork from this host. helmet's default
 * img-src is `'self' data:`, which blanks every emoji in the app the moment
 * Express starts serving the client itself — and does so silently, since a CSP
 * on a JSON response has nothing to block and no test would notice.
 */
const EMOJI_CDN = "https://em-content.zobj.net";

const app = express();

// Absent in development, where Vite serves the client on its own port.
const client = clientHandlers();

// Deployments sit behind a single proxy. Without this every client would appear
// to the rate limiters as the proxy's address and be throttled as one visitor.
app.set("trust proxy", 1);

// Ahead of the logger and the rate limiter: the platform polls this every few
// seconds, and neither a log line nor a consumed request budget per poll is
// worth having.
app.use("/healthz", healthRoutes);

app.use(pinoHttp({ logger }));
app.use(
    helmet({
        // A cross-origin JSON API by design — in development the browser app is
        // served from a different origin, which helmet's same-origin default
        // would block. Harmless when both are served from one origin.
        crossOriginResourcePolicy: { policy: "cross-origin" },
        contentSecurityPolicy: {
            directives: {
                ...helmet.contentSecurityPolicy.getDefaultDirectives(),
                "img-src": ["'self'", "data:", EMOJI_CDN],
            },
        },
    }),
);

// Before the rate limiter on purpose: one page load pulls in the document, the
// bundle, the stylesheet and four font files, so counting them against a
// 300-per-15-minutes budget would lock a visitor out after a dozen visits.
if (client.hasBuild) {
    app.use(client.assets);
}

app.use(cors(corsOptions));
// Generous enough for a base64 avatar, bounded enough that a body cannot be
// used to exhaust memory. The avatar itself is capped far lower on the way in.
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
// Must run after cookies are parsed and before any route that changes state.
app.use(csrfProtection);
app.use(apiLimiter);

//Routes
app.use("/auth", authRoutes);
app.use("/coach", coachRoutes);
app.use("/habits", habitRoutes);
app.use("/journal", journalRoutes);
app.use("/plans", planRoutes);

// After the routes, so a real endpoint always wins, and before notFoundHandler,
// so an unmatched browser route still gets the app instead of a JSON 404.
if (client.hasBuild) {
    app.use(client.fallback);
}

// Both must stay last, and in this order: unmatched requests become a
// NotFoundError, which the error handler then renders like any other failure.
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
