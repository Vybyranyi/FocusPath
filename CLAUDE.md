# CLAUDE.md

Guidance for Claude Code when working in this repository.

FocusPath is a habit-tracking app: a React 19 + Vite client and an Express 5 +
Mongoose API in one repo, sharing a type-only package and a single root `.env`.

## Commands

Run from the repo root unless noted.

| Task | Command |
| --- | --- |
| Install everything | `npm install && npm run install:all` |
| Both apps in dev | `npm run dev` (Vite on 5173, API on 3000) |
| Lint both | `npm run lint` |
| Type-check both | `npm run typecheck` |
| Test both | `npm test` |
| Build both | `npm run build` |
| One package only | `npm --prefix server run test`, `npm --prefix frontend run lint`, … |
| Watch tests (frontend) | `npm --prefix frontend run test:watch` |
| Single server test file | `npm --prefix server exec jest -- src/services/habitSchedule.test.ts` |
| Seed an admin account | `npm --prefix server run seed:admin` |
| Migrate day flags to statuses | `npm --prefix server run migrate:day-status` |

`npm test` in the frontend is `vitest run` — non-watching, safe in CI. Use
`test:watch` for the interactive runner.

## Layout

```
frontend/   React 19, Vite 7, Redux Toolkit, Tailwind 4, Vitest + jsdom
server/     Express 5, Mongoose 8, Zod 4, Jest + supertest + mongodb-memory-server
shared/     .d.ts-only contracts consumed by both via the @shared/* alias
docs/       API reference
Dockerfile  one image serving both halves; render.yaml deploys it
```

Development runs two processes on two ports; production runs one, with Express
serving the built client alongside the API. This is not a style choice — a
prior attempt to deploy client and API as two separate Render services broke
login outright (`403 FORBIDDEN` on `/auth/refresh`), because `onrender.com` is
on the Public Suffix List: two `*.onrender.com` services cannot share a
session cookie no matter how CORS or SameSite is configured, and the CSRF
cookie specifically becomes unreadable to the client's JS once it is set by a
different origin. See "Топологія розгортання" in `DESIGN.md`.

There is one `.env` at the repo root. Vite reads it through `envDir` in
`frontend/vite.config.ts`; the server loads it explicitly in `src/server.ts`.
Never add a second `.env` inside a package.

## Architectural invariants

These hold everywhere in the codebase. Breaking one locally is almost always
the wrong fix — the pattern exists because the alternative failed.

**Every response goes through the envelope.** `ok` / `created` in
`server/src/utils/apiResponse.ts` wrap success as `{ success: true, data }`;
failures come back as `{ success: false, error: { code, message, details? } }`.
Never call `res.json` directly from a handler, and never call `fail` outside the
error handler.

**Handlers throw; they do not catch.** Express 5 forwards rejected promises to
`server/src/middlewares/errorHandler.ts` on its own. Throw an `AppError`
subclass from `server/src/errors/AppError.ts` (`NotFoundError`,
`ConflictError`, `ValidationError`, …). Anything thrown that is *not* an
`AppError` is treated as a defect: logged in full, reported to the client as a
bare 500 with no internal detail. `notFoundHandler` and `errorHandler` must stay
last in `app.ts`, in that order.

**Ownership checks live in the service layer.** `requireOwnedHabit` in
`server/src/services/habitService.ts` scopes every lookup by `userId`, so "user
A cannot touch user B's habit" is a property of the layer rather than something
each endpoint has to remember. Do not query `Habit` directly from a controller.

**Zod schemas are the single source of truth for DTOs.** Types are derived with
`z.infer` in `server/src/validation/*.ts`. Never hand-write a DTO interface that
mirrors a schema — change the schema and the type follows. Requiring `z.string()`
is also what actually closes NoSQL injection: an operator object like
`{"$ne": null}` fails the type check long before it reaches a query.
`sanitizeFilter` in `server/src/config/mongoose.ts` is the second line, not the
first.

**A day travels as `YYYY-MM-DD`, and server dates are read in UTC.** The
calendar day is the user's *local* day — the one printed on the cell they
tapped. `frontend/src/lib/dates.ts` mirrors `server/src/utils/dates.ts` and is
the only place that converts. Never send a full instant for a day: local
midnight through `toISOString()` is the previous UTC day east of Greenwich,
which is how the day view spent a release fetching and marking yesterday.
Never read a timestamp from a response with local getters either — it is
midnight UTC, and local getters move it a day west of Greenwich. Day keys are
fixed-width, so comparing days is string comparison. The frontend suite is
pinned to `Europe/Kyiv` in `vite.config.ts` because under UTC this entire class
of bug is invisible by construction.

**A scheduled day has a status, not a flag.** `pending | done | failed` in
`shared/src/habit.d.ts`. `failed` is the user saying "I did not do this", which
a boolean could not express — it and "the day has not happened yet" were both
`false`. There is deliberately no stored `missed`: a `pending` day that is over
is missed, derived by `dayState` in `frontend/src/lib/habitStatus.ts`. Storing
it would need a job flipping rows at midnight in every user's own timezone, and
would be wrong until it ran. An explicit `failed` breaks the streak; today's
grace in `calculateStreak` applies only while the day is undecided.

**`shared/` holds declaration files only.** Sources are `.d.ts` on purpose:
declaration files cannot contain runtime code and are never emitted, so neither
app gains a build step or a runtime dependency. If you need a shared *value*
(a constant, a helper), it does not belong here.

**Models strip their own secrets.** The `toJSON` transforms on
`server/src/models/User.ts` and `Habit.ts` delete `password`, `tokenVersion`,
`refreshSessions`, `userId` and `__v`. Do not re-add those fields to a response
by hand, and do not bypass `toJSON` with `.lean()` without checking what leaks.

## Path aliases: three places, kept in sync

Aliases are declared separately for the compiler, the test runner and the
bundler. Adding one to a single place is the most common way to break this repo.

| Package | Files that must agree |
| --- | --- |
| server | `tsconfig.json` → `paths`, `jest.config.ts` → `moduleNameMapper` |
| frontend | `tsconfig.app.json` → `paths`, `vite.config.ts` → `resolve.alias` |

`@shared/*` points at `shared/src/*` from all four.

The server also needs `tsc-alias` at build time (`npm run build` is
`tsc && tsc-alias`) because `tsc` alone leaves the aliases in the emitted JS.

## Traps that have already bitten

- **`erasableSyntaxOnly` in the frontend** forbids constructor parameter
  properties and anything else that emits code. `ApiError` in
  `frontend/src/api/client.ts` declares and assigns fields separately for this
  reason — do not "simplify" it back.
- **`"ts-node": { "files": true }` in `server/tsconfig.json` is load-bearing.**
  ts-node compiles file by file and would otherwise never load ambient
  declarations nothing imports, including `src/types/express.d.ts`, which is
  what teaches `Request` about `userId`. Remove it and the dev server fails to
  start while `tsc` and Jest stay perfectly happy.
- **`req.query` cannot be written back in Express 5.** It is exposed through a
  getter and assignment is silently discarded, so `validate` checks query
  schemas without coercing them and handlers parse the raw strings themselves.
  `body` and `params` *are* written back and do arrive coerced.
- **Rate limiters are disabled under `NODE_ENV=test`** (`skip` in
  `server/src/middlewares/rateLimit.ts`). The suite signs in far more often than
  any real client; leaving them on would only measure the limiter.
- **The server test suite needs no `MONGO_URI`.** `jest.env.ts` sets
  `NODE_ENV`, `JWT_SECRET`, `BCRYPT_ROUNDS=4` and `CORS_ORIGIN` before any
  module is imported, and `jest.setup.ts` provides an in-memory MongoDB per run
  and clears every collection after each test. Environment must stay in
  `setupFiles`, not `setupFilesAfterEnv` — several modules read `process.env` at
  import time and would hold `undefined` if it were set later.
- **CSRF exempts requests with no session cookie.** That is what lets login and
  registration through without maintaining a path allowlist. State-changing
  calls from an authenticated client must echo the readable `csrf_token` cookie
  in the `X-CSRF-Token` header; `frontend/src/api/client.ts` does this already.
- **Refreshes are deduplicated on the client.** The server rotates the refresh
  token on every use, so two concurrent refreshes would leave the loser holding
  a spent token. `refreshInFlight` in the API client makes everyone wait on one
  attempt. Do not add a second refresh path.
- **The SPA fallback answers only requests that ask for `text/html`, except
  the root.** That is what keeps a mistyped endpoint returning the JSON
  envelope instead of an HTML page the client cannot parse, and what keeps the
  suite from depending on whether `frontend/dist` happens to exist locally.
  `/` is exempt because a health checker may send `*/*` or no `Accept` header
  at all — a live deploy was briefly marked unhealthy over exactly this.
  `/healthz` also exists, and additionally checks Mongo.
- **The fallback and `/healthz` both accept `HEAD`, not just `GET`.** Express
  maps `HEAD` onto `GET` *routes* automatically, but these are plain
  middleware doing their own method check. A live deploy answered `HEAD /`
  with 404 while `GET /` returned 200, which is precisely what takes a healthy
  instance out of rotation.
- **`DEFAULT_CLIENT_DIST` is three levels up from `__dirname`, not two.**
  `staticClient` lives under `middlewares/`, so it sits one level deeper than
  the package root — the same depth under `src/` and `dist/`. Getting it wrong
  fails nothing loudly: the app just serves no client and answers every
  navigation with a JSON 404. `CLIENT_DIST` overrides it; the image sets it.
- **helmet's default `img-src` blocks the emoji CDN.** `react-apple-emojis`
  loads artwork from `em-content.zobj.net`, which the default `'self' data:`
  refuses. Nothing on the server errors — the emoji simply vanish.

## Adding an endpoint

Order matters; the codebase follows it without exception.

1. Schema in `server/src/validation/*.ts`, plus `export type XDto = z.infer<…>`.
2. Method on the relevant service in `server/src/services/` — this is where
   ownership scoping and business rules live.
3. Controller in `server/src/controllers/` — thin, returns `ok(...)` /
   `created(...)`, throws on failure, never catches.
4. Route in `server/src/routes/`, wired with `verifyTokenMiddleware` and
   `validate({ body, params, query })`.
5. Test alongside the code (`*.test.ts`).
6. Row in `docs/API.md`, and a shared type in `shared/src/` if the response
   shape is new.

## Frontend conventions

- State is three Redux Toolkit slices (`auth`, `habit`, `calendar`). Derived
  values go through `createSelector` in `store/selectors.ts` so they are
  computed once per change rather than per render; plain field selectors are not
  memoised and should not be.
- All network calls go through `apiRequest` from `@api/client`. It unwraps the
  envelope, so callers receive `data` directly and catch `ApiError`. Use
  `errorMessage(error)` for anything shown to a user.
- Tests build an isolated store with `makeStore(preloadedState)` from
  `store/store.ts`; there are helpers in `src/testUtils.tsx`.

## Style

- **Indentation: 4 spaces in `server/src`, 2 spaces in `frontend/src`.**
  `.editorconfig` encodes this. Match the file you are editing.
- Comments explain *why*, not *what*. The existing ones are the model: they
  record the reasoning or the failure that motivated the code. Do not add
  comments that restate the line below them.
- Commit subjects are imperative and sentence-cased, no Conventional Commits
  prefix — e.g. "Extract a service layer and fix two defects it exposed".
- Route comments in `server/src/routes/habitRouter.ts` are in Ukrainian; the
  rest of the codebase comments in English. Leave existing ones as they are.

## Before you finish

`npm run lint && npm run typecheck && npm test` from the root — the same three
checks CI runs. Update `CHANGELOG.md` under `[Unreleased]`, and `docs/API.md`
if the API contract moved.
