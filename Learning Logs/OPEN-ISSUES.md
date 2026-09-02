# Open issues — the living ledger

Every known bug, shortcut, and TODO across all phases, in one place. Each line:
what, where, which phase raised it. When one is fixed, it moves to
**Recently fixed** with the phase that fixed it.

Phase deep-dives cross-reference this file by number where useful, but this is
the source of truth for status.

---

## Recently fixed

| Was | Fixed in | Note |
|---|---|---|
| `mongodb.js` never set `this.connection`; wrong event name `"Disconnected"`; exported the class not an instance | Phase 5 (`a0b0c11`) | now a real singleton with `this.connection = mongoose.connection` and `"disconnected"` |
| `logger.js` used `winston.combine` (not a function) | Phase 5 (`a0b0c11`) | → `winston.format.combine` |
| `server.js` used `cors()` without importing it | Phase 5 (`a0b0c11`) | added `import cors` |
| `scripts/init.postgress.sql` misspelled vs the compose mount | Phase 5 (`a0b0c11`) | `git mv` to `init.postgres.sql`; operational fallout (stray mount dir, volume not re-initialising, password mismatch) documented in phase-5 |
| `rabbitmq.js` error handler ignored `err` | between P1 and P5 | handler now logs the error |
| `server.js` was a `"Hi"` stub | Phase 4 | full bootstrap |
| model files empty | Phase 2 | four Mongoose schemas |
| both Dockerfiles empty | Phase 5 (`40eb9b7`) | filled |
| storage-split docs stale after the plan changed twice | Phase 4 | dated correction under phase-1 §3 |

---

## Open — would stop something working

- **`authService.js:40` calls `this.generateToken()` with no argument.** The
  method destructures `user` immediately → `TypeError`. The super-admin onboard
  flow cannot succeed. *(P6)*
- **`authenticate.js:1` import missing `.js`** — `"../utils/ResponseFormatter"`
  → `ERR_MODULE_NOT_FOUND` under ESM. *(P6)*  — same class:
  **`User.js` / `ApiKey.js` import `"../utils/SecurityUtils.js"`** but the file
  is `SecurityUtil.js` (no trailing "s"). *(P2)*
- **`authenticate.js` uses `logger` but never imports it** — a verify failure
  throws `ReferenceError` instead of returning 401. *(P6)*
- **No `cookie-parser`** — not a dependency, not `app.use`d, so `req.cookies` is
  always `undefined`; every authenticated request 401s. *(P6)*
- **`authorize.js` empty-roles branch has no `return`** — `authorize([])` calls
  `next()` then also sends 403 → "headers already sent". *(P6)*
- **`ApiKey` cannot be saved** — `keyId` / `keyValue` are `required` + `unique`
  but nothing generates them. *(P2)*
- **`errorHandler.js:5` reads `req.statusCode`, means `err.statusCode`** — every
  error is reported 500 unless an `err.name` branch overrides it; an
  `AppError("x", 404)` becomes 500. *(P4)*
- **Nothing is mounted** — `services/auth/routes/authRouter.js` is empty and
  `server.js` imports nothing under `services/`; `/api/auth/*` does not exist.
  *(P6)*
- **Controller methods lose `this` as bare route handlers** — whoever fills
  `authRouter.js` must `.bind` or wrap, or `this.authService` is `undefined`.
  *(P6, latent)*

## Open — correctness & security

- **`config/index.js`: `jwt.sercet` typo.** `config.jwt.secret` is `undefined`;
  `authService` and `authenticate` both read `config.jwt.sercet`, so it "works"
  but is now load-bearing in three files. Fix all three together. *(P1, P6)*
- **`config/index.js`: `node_env` default `"Development "`** (capital D, trailing
  space) — any `=== "development"` check fails. *(P1)*
- **`rabbitmq.js`: `getStatus()` reads `this.connect`** (the method) not
  `this.connection`; never reports `DISCONNECTED`. *(P1)*
- **`User.password` is selectable** — no `select: false`, no `toJSON` transform;
  `User.find()` returns the hash. `authService.formatUserForResponse` and
  `UserRepository.findAll` each strip it separately — three half-measures. *(P2, P6)*
- **No `User.comparePassword`** — every password check must call `bcrypt.compare`
  by hand. *(P2)*
- **`$2a$` hash guard in `User.js` is wrong** — `bcryptjs@3` emits `$2b$`, and
  the `pre('save')` hook has no "already hashed" guard, so re-saving a hashed
  value double-hashes it. *(P2)*
- **`errorHandler` leaks internal messages** — sends `err.message` for a
  non-operational error; never checks `err.isOperational`. *(P4)*
- **`errorHandler` logs everything at `error` level** including 404s and
  validation failures — real 5xx incidents get buried. *(P4)*
- **Auth middleware bypasses the central error handler** — `authenticate` /
  `authorize` build `res.json` inline instead of `next(new AppError(...))`. Two
  error styles. *(P6)*
- **`onboardSuperAdmin` guard is "any user exists", not "a super admin exists"**
  — uses `findAll()` (all active users). *(P6)*
- **`ApiKey` expiry TTL deletes the key document** (`expireAfterSeconds: 0`) —
  no audit trail of which keys existed. *(P2)*
- **`ApiHits` 30-day TTL is global** — `Client.settings.dataRetentionDays`
  (7-365) is never honoured. *(P2)*
- **`process.env` read outside `config/index.js`** — `SecurityUtil.js` (5 vars),
  `ApiKey.js` (`API_KEY_EXPIRY_DAYS`). *(P2)*
- **`dotenv.config()` called twice** — `server.js:12` and `config/index.js:4`.
  The `server.js` call runs after all imports resolve, so it helps nothing.
  *(P1, P4)*
- **No referential integrity** — ObjectId refs have no FK; deleting a `Client`
  orphans its `User` / `ApiKey` / `ApiHit`. *(P2)*
- **CORS is wide open** — `cors()` with no config allows every origin. *(P4)*
- **DB credentials hard-coded in `docker-compose.yaml`** (`PG_PASSWORD: password`,
  `admin:12345`, Mongo unauth). *(P5)*
- **`JWT_SECRET: ${JWT_SECRET}` in compose is fragile** vs `server/.env`'s
  `KEY = value` spacing — verify it is populated (`docker compose config`). *(P5)*
- **Neither Docker image sets a non-root `USER`** — both run as root. *(P5)*
- **`/health` is not a real readiness probe** — returns `uptime`, not "can I
  reach Mongo/Postgres/Rabbit". The `api-app` healthcheck hits it anyway. *(P5)*
- **`gracefulShutdown` has no timeout** — a hung `server.close()` callback hangs
  the process forever. *(P4)*
- **`uncaughtException` runs the full async shutdown** from a process already in
  an undefined state. *(P4)*

## Open — hygiene & consistency

- **Role strings duplicated three ways** — `shared/constants/roles.js` (new
  source of truth), `User.js` `enum` literal, `UserRepository.create` literal
  `"super_admin"`. *(P6)*
- **Folder casing** — `shared/Middleware/`, `services/auth/Dependencies/`
  capitalised; every sibling (`config/`, `models/`, `utils/`, `constants/`,
  `controller/`, `service/`, `repository/`, `routes/`) lowercase. Bites on
  case-sensitive filesystems (the Docker image). *(P4, P6)*
- **`ResponseFormatter` — the four methods disagree on their own fields**:
  `statusCode` present in `success`/`error`, absent in `validationError`/
  `paginated`; arg order flips between `success(data,msg,code)` and
  `error(msg,code,error)`; `paginated()` divides by `limit` with no zero guard;
  `validationError()` takes no status. `AppError.errors` (plural) vs the
  formatter's `error` (singular) param. *(P3)*
- **Body `statusCode` can contradict the real HTTP status** — two sources of
  truth. *(P3)*
- **`/health` returns a `Timestamp` inside `data`** duplicating the envelope's
  own `timestamp`. *(P4)*
- **Request logger logs on arrival only** — no status code, no duration; should
  log from `res.on("finish")`. *(P4)*
- **`endpoint_metrics.client_id` is an unvalidated `VARCHAR(24)`** — no CHECK,
  no FK possible (points at a Mongo doc). *(P4)*
- **Duplicate Mongoose index definitions** — `unique: true` + `index: true` on
  `ApiKey.keyId` / `keyValue` / `ApiHits.eventId`; `ApiKey.expiresAt` field
  `index` + a separate `schema.index(...)`. *(P2)*
- **`ApiKey` has two `createdBy` fields** — `metadata.createdBy` (optional) and
  top-level (required). *(P2)*
- **Naming drift** — file `ApiHits.js`, model `"ApiHit"`, collection `api_hits`.
  *(P2)*
- **`Client` under-validated** — `email` has no format check (unlike
  `User.email`); `website` accepts anything; `slug` is not derived from `name`.
  *(P2)*
- **Weak IP/CIDR validator** on `ApiKey.security.allowedIPs` — accepts
  `999.999.999.999/99`. *(P2)*
- **`User.password` schema `minlength: 6` vs `SecurityUtils` `minLength: 8`** —
  two disagreeing numbers. *(P2)*
- **`postgres.js` comments are Roman-Urdu/Hinglish** — pick one comment language
  project-wide. *(P1)*
- **`generateToken` puts a Mongoose `ObjectId` in the JWT payload** — comes back
  a string on verify; document it or `String(_id)`. *(P6)*
- **Mongo port mismatch** — compose publishes `27018:27017`; `server/.env` and
  the code default use `27017`. Fine inside the compose network (`mongo:27017`),
  a trap for a local run against the compose Mongo. *(P1)*
- **Container Node is `18-alpine` (EOL Apr 2025); dev runs Node 24.** *(P5)*

## Deferred by design (not bugs)

- The **consumer process** (`src/consumer.js`) does not exist — nothing drains
  `api_hits` or writes `endpoint_metrics`. The `consumer` compose service is
  gated behind a profile until it does.
- **No RabbitMQ reconnect-with-backoff**, though `retryAttempts` / `retryDelay`
  are already in config.
- **No aggregation models** beyond raw `ApiHits`.
- **`SecurityUtils` has only `validatePassword`** — token/key generation and
  encryption are named in its docstring as future homes, not built.
- **`RBAC` (role enum) vs capability flags (`permissions` block)** — the `User`
  model carries both and reconciles neither; a decision deferred.
- **No tests, linter/formatter config, or CI.**
- **`AppError` can only represent operational errors** — `isOperational` is
  hard-coded `true`; a fatal-state subclass would need it as a parameter.
- **`mongo` has no healthcheck**; `pgadmin` `depends_on` does not wait for
  Postgres readiness.
