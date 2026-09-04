# Open issues — the living ledger

Every known bug, shortcut, and TODO across all phases, in one place. Each line:
what, where, which phase raised it. When one is fixed, it moves to
**Recently fixed** with the phase that fixed it.

---

## Recently fixed

| Was | Fixed in | Note |
|---|---|---|
| `config/index.js` `jwt.sercet` typo | **Phase 7** (`2fe568e`) | `config.jwt.secret` was `undefined`; by P6 three files read the typo. All corrected together. |
| `config/index.js` `node_env` default `"Development "` (capital D, trailing space) | **Phase 7** | → `"development"`; `=== "development"` branches were silently dead. |
| `dotenv.config()` called twice (`server.js` + `config/index.js`) | **Phase 7** | removed from `server.js` (it ran after all imports anyway). |
| `errorHandler` read `req.statusCode` instead of `err.statusCode` | **Phase 7** | every `AppError` was reported 500. |
| `errorHandler` logged all 4xx at `error` level | **Phase 7** | now `>=500` → `error`, else `warn`. |
| `errorHandler` leaked `err.message` on unexpected 5xx | **Phase 7** | now generic `"Internal server error"` when `!err.isOperational`. |
| `authenticate.js` import missing `.js`; used `logger` without importing it | **Phase 7** | both fixed; also now a named export. |
| `authorize([])` fell through and double-responded | **Phase 7** | `next()` → `return next()`. |
| `authService.generateToken()` called with no argument | **Phase 7** | → `generateToken(user)`. |
| `onboardSuperAdmin` guard was "any user exists" | **Phase 7** | → `userRepository.count({ role: "super_admin" })`. |
| no `cookie-parser` — `req.cookies` always `undefined` | **Phase 7** | added to `package.json` + `app.use(cookieParser())`. |
| controller methods lose `this` as bare route handlers | **Phase 7** | router wraps each in `(req,res,next) => ctrl.method(...)`. |
| `User.js` `$2a$` hash guard didn't match bcryptjs 3's `$2b$` | **Phase 7** | → regex `/^\$2[aby]\$/`. (pre-save "already hashed" guard still absent, but the async hook + `isModified` check make the common path safe.) |
| `User.js` imported `"../utils/SecurityUtils.js"` (wrong name) | **Phase 7** | fixed for `User.js`. `ApiKey.js` still wrong — latent. |
| request logger had no status / duration | **Phase 7** | new `requestLogger.js` logs on `res.on("finish")` with both. (Old inline logger in `server.js` not removed — see below.) |
| the whole `services/auth/` slice was unreachable (empty router) | **Phase 7** | `authRouter` filled + `app.use("/api/auth", authRouter)`. Only `onboard-super-admin` fully works. |
| `mongodb.js` unusable; `logger.js` `winston.combine`; `server.js` missing `import cors`; `init.postgress.sql` misspelled | Phase 5 | see phase-5 |
| `server.js` was a `"Hi"` stub; both Dockerfiles empty; model files empty | Phases 2/4/5 | |
| storage-split docs stale after the plan changed twice | Phase 4 | dated correction under phase-1 `1-product-and-architecture.md` |

---

## Open — would stop something working

- **`authController` has only `onboardSuperAdmin`.** The router calls
  `authController.register` / `.login` / `.getProfile` / `.logout` — none exist.
  Those four routes throw `TypeError` → `errorHandler` → generic 500. *(P7)*
- **`authService.login` calls `this.comparePassword(...)`** — no such method on
  `AuthService`, and no `User.comparePassword` either. Login can't succeed even
  with a controller method. *(P7, and P2 "no comparePassword")*
- **`ApiKey` cannot be saved** — `keyId` / `keyValue` are `required` + `unique`
  but nothing generates them. *(P2 — latent, nothing imports `ApiKey`)*
- **`ApiKey.js` imports `"../utils/SecurityUtils.js"`** (wrong name). Fatal under
  ESM the moment anything imports `ApiKey`. *(P2 — latent)*
- **`rabbitmq.getStatus()` reads `this.connect`** (the method) not
  `this.connection`; never reports `DISCONNECTED`. *(P1)*

## Open — correctness & security

- **`onboard-super-admin` has a race.** No `authenticate` (correct — no admin
  yet); guarded only by `count({role}) > 0`. Two simultaneous requests can both
  create a super admin. Fix: a partial unique index on `{ role: "super_admin" }`.
  *(P7)*
- **Validation is split and inconsistent.** `validate(schema)` checks
  `required` / `minLength: 6` / `custom` only — not email format or the real
  password policy (uppercase/number/symbol, min 8), which run only inside
  `user.save()`. A weak password passes the door and fails two layers deeper.
  The two layers also disagree on the minimum (6 vs 8). *(P7)*
- **`checkSuperAdminPermissions` has an empty `catch (error) {}`** — swallows DB
  errors, returns `undefined`. *(P7)*
- **`GET /logout` should be `POST`** — clearing the auth cookie is a state
  change; a `GET` can be fired by a prefetch or a crawled link. *(P7)*
- **`cors({ origin: true })`** — reflects any origin. `credentials: true` was
  fixed in P7; the "allow any site" part must be pinned to the dashboard URL
  before production. *(P4, P7)*
- **`login` reads `user.password`** and `findByUsername` does a plain `findOne`.
  Works today (no `select: false` on the field), but adding `select: false` — an
  open hardening item — would silently break login unless `findByUsername`
  switches to `.select("+password")`. *(P2, P7)*
- **`User.password` is selectable** — no `select: false`, no `toJSON` transform.
  `authService.formatUserForResponse` and `UserRepository.findAll` each strip it
  separately (two half-measures; `login` actually depends on it *not* being
  stripped). *(P2)*
- **Auth middleware bypasses the central error handler** — `authenticate` /
  `authorize` / `validate` build `res.json` inline instead of
  `next(new AppError(...))`. Two error styles. *(P6, P7)*
- **`registrationSchema` lets a super admin create another `super_admin`** via
  `/register` (role is an allowed field). `onboardSuperAdmin`'s "only one" guard
  does not apply there. Confirm this is intended. *(P7)*
- **`ApiKey` expiry TTL deletes the key document** (`expireAfterSeconds: 0`) — no
  audit trail. *(P2)*
- **`ApiHits` 30-day TTL is global** — `Client.settings.dataRetentionDays` is
  never honoured. *(P2)*
- **`process.env` read outside `config/index.js`** — `SecurityUtil.js`,
  `ApiKey.js`. *(P2)*
- **No referential integrity** — ObjectId refs have no FK; deleting a `Client`
  orphans its `User` / `ApiKey` / `ApiHit`. *(P2)*
- **DB credentials hard-coded in `docker-compose.yaml`**; `JWT_SECRET: ${JWT_SECRET}`
  fragile vs `.env` spacing; neither Docker image sets a non-root `USER`;
  `/health` is not a real readiness probe; `api-app` doesn't wait for Mongo
  (no healthcheck); `gracefulShutdown` has no timeout; `uncaughtException` runs
  the full async shutdown. *(P4, P5)*

## Open — hygiene & consistency

- **Two request loggers.** `server.js` still has its inline on-arrival logger;
  `requestLogger.js` (on-finish, with status) is attached per-route. Auth
  requests are logged twice, in two formats. Remove the inline one. *(P7)*
- **Role strings duplicated** — `shared/constants/roles.js` is the source of
  truth, but `User.js` still hard-codes its `enum` and `UserRepository.create`
  hard-codes `"super_admin"`. *(P6)*
- **Folder casing** — `shared/Middleware/`, `services/auth/Dependencies/` are
  capitalised; every sibling is lowercase. Bites on case-sensitive filesystems
  (the Docker image). *(P4, P6)*
- **`ResponseFormatter` — the four methods disagree** on their own fields:
  `statusCode` present in `success`/`error`, absent in `validationError`/
  `paginated`; arg order flips between `success(data,msg,code)` and
  `error(msg,code,error)`; `paginated()` divides by `limit` with no zero guard;
  `validationError()` takes no status. `AppError.errors` (plural) vs the
  formatter's `error` (singular) parameter. *(P3)*
- **Body `statusCode` can contradict the real HTTP status.** *(P3)*
- **`/health` returns a `Timestamp` inside `data`** duplicating the envelope's
  own `timestamp`. *(P4)*
- **`GET /` endpoint map** in `server.js` doesn't list `/api/auth/profile` etc.
  — cosmetic drift. *(P7)*
- **`endpoint_metrics.client_id` is an unvalidated `VARCHAR(24)`.** *(P4)*
- **Duplicate Mongoose index definitions** on `ApiKey` / `ApiHits`. *(P2)*
- **`ApiKey` has two `createdBy` fields**; naming drift `ApiHits.js` / `"ApiHit"`
  / `api_hits`; `Client` under-validated (`email` / `website` / `slug`); weak
  IP/CIDR validator. *(P2)*
- **`User.password` schema `minlength: 6` vs `SecurityUtils` `minLength: 8`.** *(P2)*
- **`postgres.js` comments are Roman-Urdu/Hinglish** — pick one language. *(P1)*
- **`generateToken` puts a Mongoose `ObjectId` in the JWT payload** — comes back
  a string on verify. *(P6)*
- **`parseInt(process.env.PORT || 8080)` missing radix `10`.** *(P1)*
- **Mongo port mismatch** — compose publishes `27018:27017`; `.env` / code
  default `27017`. Fine inside the compose network, a trap for a local run
  against the compose Mongo. *(P1)*
- **Container Node is `18-alpine` (EOL Apr 2025); dev runs Node 24.** *(P5)*
- **`sameSite: "strict"` on the auth cookie** — not sent on a top-level
  navigation from another site. Fine for an SPA + API; note it if a
  redirect-based flow is ever added. *(P7)*

## Deferred by design (not bugs)

- The **consumer process** (`src/consumer.js`) does not exist — nothing drains
  `api_hits` or writes `endpoint_metrics`. The `consumer` compose service is
  gated behind a profile.
- **No RabbitMQ reconnect-with-backoff**, though `retryAttempts` / `retryDelay`
  are in config.
- **No aggregation models** beyond raw `ApiHits`.
- **`SecurityUtils` has only `validatePassword`** — token/key generation and
  encryption are named in its docstring as future homes, not built.
- **`RBAC` (role enum) vs capability flags (`permissions` block)** — `User`
  carries both and reconciles neither.
- **No tests, linter/formatter config, or CI.**
- **`AppError` can only represent operational errors** — `isOperational` is
  hard-coded `true`.
- **`mongo` has no healthcheck**; `pgadmin` `depends_on` does not wait for
  Postgres readiness.
