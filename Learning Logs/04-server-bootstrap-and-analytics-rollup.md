# 04 - Server Bootstrap, Error Middleware, and the Analytics Rollup

**Covers:** working-tree changes on top of commit `1cb8f56` - a full rewrite of
`server/src/server.js`, a new `server/src/shared/Middleware/errorHandler.js`, and
the first real contents of `server/scripts/init.postgress.sql`. Not yet
committed at time of writing.
**Date range of work:** 29 Aug 2026.
**State of the app at end of this phase:** `server.js` is no longer a stub - it
builds an Express app, mounts a middleware stack, serves `/` and `/health`,
connects all three datastores before listening, and shuts down cleanly on a
signal. It does **not start as written** (see Issue 1: `cors` is used but never
imported). No feature routes exist yet; `/api/auth`, `/api/hit`, and
`/api/analytics` are advertised in the root response but not mounted. The
consumer process still does not exist, so nothing writes the new Postgres table.

---

## 1. Scope

Three files, one theme: turning a pile of modules into a running process.

- `src/server.js` - the entry point. Express app, security and body-parsing
  middleware, request logging, two info routes, a 404, the error handler, then a
  startup routine that connects Mongo + Postgres + RabbitMQ before
  `app.listen`, plus signal handlers for graceful shutdown.
- `src/shared/Middleware/errorHandler.js` - the single Express error middleware.
  Translates thrown errors (including Mongoose and JWT errors) into a
  `ResponseFormatter.error` envelope.
- `scripts/init.postgress.sql` - creates `endpoint_metrics`, a **pre-aggregated
  rollup table** in PostgreSQL: one row per (client, service, endpoint, method,
  time bucket) with hit counts and latency stats, plus indexes and an
  `updated_at` trigger.

---

## 2. Context: what this unblocks

Phases 01-03 built parts with no assembly point: config, logger, three
connection singletons, four models, two utility classes. Nothing ran. This phase
is the assembly point. Once Issue 1 is fixed, `npm run dev` produces a live HTTP
server with health checks and clean shutdown - a frame with somewhere to add
routes.

This phase also reintroduces PostgreSQL, which Phase 02 had left with no caller.
Its job here is not what Phase 01 planned (accounts): it holds `endpoint_metrics`,
a pre-aggregated rollup table. Storage now stands at: raw hits and accounts in
Mongo, rolled-up metrics in Postgres. Phase 01 section 3 carries a dated
correction covering the two shifts.

---

## 3. Concepts

### 3a. Bootstrap order: connect first, listen last

`startServer()` (`server.js:87`) does `await initializeConnection()` **before**
`app.listen()`. `initializeConnection()` (`server.js:72`) opens Mongo, tests the
Postgres pool, and opens RabbitMQ, and rethrows if any fail.

Why this order: if a datastore is unreachable, you want the process to die now,
loudly, on boot - not to start accepting HTTP traffic and then return 500 on
every request while looking "up" to a load balancer. **Do not open the shop
doors until the lights and the registers work.** This is the same fail-fast
instinct as the Postgres boot smoke test from Phase 01, applied to the whole
app.

### 3b. Middleware order is execution order

Express runs `app.use(...)` handlers top to bottom, in registration order, on
every request. So the stack in `server.js:16-26` is a deliberate pipeline:

1. `helmet()` - set defensive response headers first, before anything can reply.
2. `cors()` - add cross-origin headers (so the browser dashboard on another
   origin can call the API).
3. `express.json()` / `express.urlencoded({ extended: true })` - parse the
   request body into `req.body` **before** any route reads it. Without these,
   `req.body` is `undefined`.
4. Request logger - log every incoming request through Winston.
5. Routes (`/health`, `/`).
6. 404 handler - reached only if no route matched.
7. `errorHandler` - reached only via `next(err)` or a thrown/rejected route.

Get the order wrong and you get quiet bugs: a route mounted above
`express.json()` sees no body; a logger below the routes never logs the ones
that responded early.

### 3c. The security and parsing middleware, one line each

- **`helmet()`** - a bundle of hardening headers in one call: HSTS,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options`, a restrictive
  `Content-Security-Policy`, and more. Phase 01 listed it as installed-but-unused;
  it is used now.
- **`cors()`** - writes `Access-Control-Allow-*` headers so browsers permit
  cross-origin calls. Called with no options, which means "allow every origin" -
  fine for local dev, too loose for production (Issue 13).
- **`express.json()`** - parses `Content-Type: application/json` bodies.
- **`express.urlencoded({ extended: true })`** - parses HTML form posts.
  `extended: true` uses the `qs` library so nested keys (`a[b]=c`) work.

### 3d. Express error middleware: the 4-argument signature

`errorHandler` is `(err, req, res, next)` - **four** parameters. Express
identifies error-handling middleware purely by arity: a function with four args
is only invoked when something upstream calls `next(err)`, or a synchronous
route throws, or (Express 5, see Phase 01 section 5) an async route's promise
rejects. It is registered **last** (`server.js:69`), after the routes and the
404, because it is the catch-all bottom of the pipe.

One place formats every error. A route's job becomes "throw a meaningful error";
the middleware's job is "turn any error into the right status + envelope."

### 3e. Graceful shutdown

Phase 01 gave every connection a `close()` "for later." This is later.
`gracefulShutdown(signal)` (`server.js:96`) runs on `SIGINT` (Ctrl-C) or
`SIGTERM` (what Docker / Kubernetes send to stop a container):

1. `server.close(cb)` - stop accepting **new** connections; the callback fires
   once in-flight requests finish.
2. In that callback: `await` disconnect Mongo, Postgres, RabbitMQ.
3. `process.exit(0)` on success, `exit(1)` if a close threw.

The alternative - just letting the process be killed - drops in-flight requests
mid-response and can leave sockets, channels, and transactions half-open.
**Finish the conversation you're in, then hang up.** (It has no timeout guard,
Issue 9.)

### 3f. Process-level safety nets, and their caveat

`server.js:116-124` registers `uncaughtException` and `unhandledRejection`
handlers - the last line of defence for a bug that escaped every `try/catch`.
Both log and then call `gracefulShutdown`.

The caveat: after an `uncaughtException`, Node's own guidance is that the process
is in an **undefined state** - you should log and exit, not resume serving. This
code does exit (via `gracefulShutdown` -> `process.exit`), so the intent is
right, but running the full async shutdown from an already-broken process is
fragile. A bounded "log, flush, `process.exit(1)`" is the safer shape (Issue 10).

### 3g. Pre-aggregation: why a rollup table exists

Answering "how many hits did `/orders` get per hour last week, and the average
latency" by scanning millions of raw `ApiHits` documents on every dashboard load
is slow and only gets slower. The fix is to **compute the answer once, as data
arrives, and store the summary.**

`endpoint_metrics` is that summary. Its columns describe how it is meant to be
maintained: for each hit, find-or-create the row for its (client, service,
endpoint, method, time bucket), bump `total_hits`, bump `error_hits` when the
status is an error, and fold the latency into `avg/min/max`. Whatever writes it
(the consumer, once built) does that folding as hits arrive; dashboards then read
a small, indexed table instead of aggregating a firehose. Nothing writes it yet.

Trade-off: the rollup is derived data that drifts or goes wrong if the writer has
a bug, and it fixes the query shapes in advance - a question the buckets do not
support still needs the raw events (which is why raw hits are kept for 30 days).

### 3h. Time bucketing

The comment at `init.postgress.sql:19` - `10:25 => 1 req (Time Roundoff) [10:00
11:00]` - is the whole idea: a hit at 10:25 is attributed to the 10:00 bucket.
Every hit in that hour collapses into one row. `time_bucket TIMESTAMP` stores the
**start** of the bucket. Coarser buckets = fewer rows, less storage, less
precision. This is how you get "usage over time" charts without one point per
request.

### 3i. Upsert via a UNIQUE constraint

`UNIQUE(client_id, service_name, endpoint, method, time_bucket)`
(`init.postgress.sql:16`, commented "Insert | Update") is not just a data-integrity
rule - it is shaped to be the **target of an upsert**:
`INSERT ... ON CONFLICT (those five columns) DO UPDATE SET total_hits =
endpoint_metrics.total_hits + EXCLUDED...`. Without a unique constraint on the
grouping key, `ON CONFLICT` has nothing to match and the "increment the existing
bucket" pattern becomes a race between a read and a write.

### 3j. SQL has no automatic timestamps - hence the trigger

Mongoose's `timestamps: true` maintains `createdAt` / `updatedAt` for free.
Raw PostgreSQL does not. `init.postgress.sql:26-35` defines a
`update_updated_at_column()` function and a `BEFORE UPDATE ... FOR EACH ROW`
trigger that sets `NEW.updated_at = CURRENT_TIMESTAMP` on every update.
`created_at` needs no trigger - its `DEFAULT CURRENT_TIMESTAMP` fires once on
insert.

### 3k. An idempotent init script

Every statement is re-runnable: `CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, and
`DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`. That matters because a
container init script can run on every boot; it must not error on the second
run. (It is also, per Issue 6, still not wired to run at all.)

---

## 4. Walkthrough

Each file below gets the same three-part pass: **what we did** (the concrete
change), **what it does** (runtime behaviour), **why it is built that way** (the
decision and the alternative rejected). Bugs are named in passing and detailed in
section 5.

### 4a. `server.js` - from stub to entry point

**What we did.** Phase 01 left `server.js` as an eight-line stub: create an
Express app, respond `"Hi"` on `/`, listen. This phase replaces it with a
~130-line entry point that has four jobs:

1. Build the Express app and its middleware chain.
2. Serve `GET /` and `GET /health`, plus a catch-all 404.
3. On startup, open Mongo + Postgres + RabbitMQ **before** binding the port.
4. On a shutdown signal or a fatal error, close everything in order and exit.

**What it does at runtime.**

- *On boot:* `startServer()` runs. It first `await`s `initializeConnection()`,
  which connects Mongo, tests the Postgres pool, and connects RabbitMQ, one after
  another, logging each stage. If any step throws, the error propagates out,
  `startServer()`'s `catch` logs `"Failed to start server"` and calls
  `process.exit(1)` - **the process never begins listening**. Only when all three
  succeed does `app.listen(config.port)` run and the port open.
- *Per request:* the request passes through the middleware chain in registration
  order - `helmet` (security headers) -> `cors` (cross-origin headers) ->
  `express.json` / `express.urlencoded` (fill `req.body`) -> the inline logger
  (one Winston `info` line: method, path, ip, user-agent) -> route matching.
  `/` and `/health` return a `ResponseFormatter.success` envelope; anything
  unmatched hits the trailing `app.use` and returns a 404 envelope.
- *On `Ctrl+C` or container stop:* the `SIGINT` / `SIGTERM` handler calls
  `gracefulShutdown`, which runs `server.close()` (stop accepting new
  connections, wait for in-flight ones to finish), then in that callback
  disconnects Mongo, Postgres, and RabbitMQ, then `process.exit(0)`.
  `uncaughtException` and `unhandledRejection` funnel into the same path after
  logging.

**Why it is built this way.**

- **Connect before listen.** `initializeConnection()` runs before
  `app.listen()`. If a datastore is down you want the crash on boot - loud and
  immediate - not a server that looks healthy to the load balancer while
  returning 500 on every request. Same fail-fast instinct as Phase 01's Postgres
  boot smoke test, applied to the whole process.
- **Middleware order is execution order.** Express runs `app.use` handlers top to
  bottom, so the sequence is chosen on purpose: security headers before any
  handler can reply; body parsing before any route reads `req.body`; logging
  before the routes; the 404 after all routes; the error handler dead last. Mount
  a body parser after a route that needs `req.body` and that route silently sees
  `undefined` - the usual way this goes wrong.
- **`helmet()`** - one call installs a bundle of hardening headers (HSTS,
  `X-Content-Type-Options: nosniff`, frame options, a base CSP). Phase 01 listed
  it as installed-but-unused; it is wired in now.
- **`cors()`** - writes `Access-Control-Allow-*` headers so the browser dashboard
  on a different origin can call the API. Called with no options, which means
  "allow every origin" - acceptable locally, too open for production. (It is also
  **used but never imported** - Issue 1.)
- **`express.json()` + `express.urlencoded({ extended: true })`** - turn a JSON or
  HTML-form request body into `req.body`. `extended: true` uses `qs` so nested
  keys (`a[b]=c`) parse. Without these, `req.body` is `undefined`.
- **The inline request logger** - a homemade access log. It logs on *arrival*, so
  it captures no status code or duration; a fuller version would log from
  `res.on("finish")` (Issue 14).
- **`/health`** returns `status`, `process.uptime()`, and a timestamp - the shape
  an uptime monitor or load-balancer probe expects.
- **404 as trailing middleware, not a route.** `app.use` with no path, placed
  after every route, catches whatever fell through. It formats its own response
  instead of calling `next(new AppError(...))`, so the 404 body and the error
  body are built in two different places and can drift (Issue 3).
- **Graceful shutdown** turns the `close()` methods Phase 01 defined "for later"
  into a real lifecycle: refuse new work, drain in-flight work, close
  connections, exit. The alternative - letting the process be killed outright -
  drops responses mid-write and can leave AMQP channels and DB transactions
  half-open.
- **`uncaughtException` / `unhandledRejection` handlers** are the last net for a
  bug that escaped every `try/catch`: log it, then exit through
  `gracefulShutdown`. Node's own guidance is to exit after an
  `uncaughtException`, not resume - this does exit, though running the full async
  shutdown from an already-corrupt process is itself fragile (Issue 10).

This file is the first real consumer of `ResponseFormatter`. `AppError`, built in
Phase 03, still has none (Issue 4).

### 4b. `errorHandler.js` - one place that turns errors into responses

**What we did.** Added `src/shared/Middleware/errorHandler.js`: a single Express
error-handling middleware (37 lines), registered as the final `app.use` in
`server.js`.

**What it does at runtime.** It is invoked only when a route calls `next(err)`,
throws synchronously, or (Express 5) returns a rejected promise. For each error
it:

1. Seeds a `statusCode`, `message`, and `errors` from the error object.
2. Writes one Winston `error` line with the message, status, stack, and the
   request's path and method.
3. Looks at `err.name` and, for four known framework error types, overrides the
   status and message:

| `err.name` | Mapped to | Why that mapping |
|---|---|---|
| `ValidationError` (Mongoose) | 400, `"Validation Error"`, `errors` = list of field messages | Failed schema validation is the caller's bad input, not a server fault. |
| `MongoServerError`, `code 11000` | 409, `"Duplicate key error"` | A unique-index collision (email taken, slug taken). 409 Conflict is the honest status. |
| `JsonWebTokenError` | 401, `"Invalid token"` | Malformed or bad-signature JWT. |
| `TokenExpiredError` | 401, `"Token expired"` | Structurally valid JWT, past expiry - its own message so the client knows to refresh. |

4. Sends `res.status(statusCode).json(ResponseFormatter.error(message,
   statusCode, errors))` - the Phase 03 envelope.

**Why it is built this way.** Routes should be free to `throw` and forget;
exactly one place should decide the status code, the log line, and the body
shape. Centralising it means every future route inherits correct error behaviour
for nothing, and the translation of framework-specific errors (Mongoose, JWT)
into clean client responses lives in one auditable spot instead of a `try/catch`
copied into every handler.

**Where it falls short** (detail in section 5): it reads `req.statusCode` where
it means `err.statusCode`, so an `AppError`'s own code is ignored (Issue 2); it
never checks `err.isOperational`, so a raw bug's message can still reach the
client (Issues 7-8); and it logs 4xx at `error` level, which will bury real
incidents (Issue 7).

### 4c. `init.postgress.sql` - the analytics rollup table

**What we did.** The file had been empty since Phase 01. It now holds a complete
schema for one table, `endpoint_metrics`: column definitions, a composite
`UNIQUE` constraint, four indexes, a trigger function, and the trigger that uses
it.

**What it does.** Run against the Postgres database, it creates - idempotently,
via `IF NOT EXISTS` / `OR REPLACE` - a table that stores **one pre-aggregated row
per (client, service, endpoint, method, time bucket)**. Each row carries running
totals (`total_hits`, `error_hits`) and latency stats (`avg_latency`,
`min_latency`, `max_latency`). The trigger refreshes `updated_at` on every
`UPDATE`.

**Why it exists.** Answering "hits per hour for `/orders` last week, with average
latency" by scanning millions of raw `ApiHits` documents on every dashboard load
does not scale. The rollup exists so that folding-in happens once, as hits
arrive, and dashboards read this small indexed table instead. Raw hits are still
kept 30 days for the questions fixed buckets cannot answer. Nothing folds hits in
yet - the writer does not exist.

**Why each piece:**

- **The grouping columns** (`client_id`, `service_name`, `endpoint`, `method`,
  `time_bucket`) are the identity of a bucket. `time_bucket` stores the *start*
  of the interval; the comment `10:25 => [10:00 11:00]` is the rule - a hit at
  10:25 is attributed to the 10:00 bucket, and every hit that hour updates the
  same row.
- **`UNIQUE(client_id, service_name, endpoint, method, time_bucket)`** is not
  only an integrity rule, it is shaped to be an upsert target - a writer can do
  `INSERT ... ON CONFLICT (those columns) DO UPDATE SET total_hits =
  total_hits + 1, ...`. With no unique constraint on the grouping key,
  `ON CONFLICT` has nothing to match and "increment the existing bucket" becomes
  a read-then-write race.
- **`NUMERIC(10,3)` for latencies**, not `float` - fixed-point arithmetic, so
  folding values in over and over does not accumulate binary floating-point
  drift.
- **`client_id VARCHAR(24)`** - a Mongo ObjectId as a hex string. This table is
  in a different database from the `Client` document it refers to, so no foreign
  key is possible; the string is an opaque cross-store pointer the consumer must
  keep honest (Issue 15).
- **Four indexes** (`client_id`; `(client_id, service_name)`; `time_bucket`;
  `(client_id, service_name, endpoint)`) cover the obvious read patterns for this
  table - by tenant, by tenant + service, by time range, by tenant + service +
  endpoint - using the same left-prefix logic as the Mongo compound indexes in
  Phase 02.
- **The `updated_at` trigger** - Mongoose maintains `createdAt` / `updatedAt` for
  free with `timestamps: true`; raw SQL does not, so a `BEFORE UPDATE ... FOR
  EACH ROW` trigger sets `NEW.updated_at = CURRENT_TIMESTAMP` on every write.
  `created_at` needs only its column `DEFAULT`, which fires once on insert.
- **Idempotent throughout** - `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT
  EXISTS`, `CREATE OR REPLACE FUNCTION`, and `DROP TRIGGER IF EXISTS` before
  `CREATE TRIGGER` - because a container init script can run on every boot and
  must not error on the second run. (It is still not wired to run at all -
  Issue 6.)

---

## 5. Issues, shortcuts, and TODO

Blunt list.

1. **`cors` is used but never imported** (`server.js:17`). `ReferenceError: cors
   is not defined` at module load - the server does not start. Add
   `import cors from "cors";`.
2. **`errorHandler.js:5` reads `req.statusCode`; should be `err.statusCode`.**
   `req` has no such property, so every error is 500 unless an `err.name` branch
   overrides it. `new AppError("Not found", 404)` is reported as 500. Same typo
   family as Phase 01 Issue 7.
3. **Nothing reaches `errorHandler` yet.** No route throws or calls `next(err)`;
   the 404 handler self-responds. The middleware is registered but dormant and
   untested. Make the 404 do `next(new AppError("Endpoint not found", 404))` so
   error formatting lives in one place.
4. **`AppError` still has zero consumers.** Built in Phase 03; `server.js` uses
   `ResponseFormatter` directly and never constructs one.
5. **`dotenv.config()` called twice** (`server.js:11` + `config/index.js`) -
   Phase 01 Issue 12, still open. On `server.js:11` it runs after all imports
   resolve, so it cannot help any module that reads `process.env` at import
   time. Delete this line; keep the one in `config/index.js`.
6. **`init.postgress.sql` filename still wrong** (Phase 01 Issue 10).
   `docker-compose.yaml` mounts `init.postgres.sql` (single "s"); the file is
   `init.postgress.sql`. Now that it has real content, it still never runs on
   first boot. Rename the file (or the compose path).
7. **`errorHandler` logs everything at `error` level**, including 404s and
   validation failures. Real 5xx incidents will drown in 4xx noise. Log
   operational 4xx at `warn`/`info`, 5xx at `error`, keyed off
   `err.isOperational` / `statusCode`.
8. **`errorHandler` leaks internal messages.** For a non-operational error it
   still sends `err.message` to the client. Send a generic
   `"Internal server error"` when `!err.isOperational`; only show the real
   message for `AppError`.
9. **`gracefulShutdown` has no timeout.** If `server.close()`'s callback never
   fires (a hung keep-alive connection), the process hangs forever. Add
   `setTimeout(() => process.exit(1), 10000).unref()`.
10. **`uncaughtException` runs the full async shutdown** from a process that is
    by definition in a corrupt state. Prefer log -> short flush -> hard
    `process.exit(1)`.
11. **`Middleware/` is capitalised** while `config/`, `models/`, `utils/` are
    lowercase. It works because `server.js` imports it with the same capital M,
    but it breaks the convention and will bite on case-sensitive filesystems
    (i.e. the Docker image) the first time someone types `middleware/`.
12. **`/health` returns a `Timestamp` inside `data`** that duplicates the
    envelope's `timestamp`. Pick one.
13. **CORS is wide open.** `cors()` with no config allows all origins. Before any
    deploy, pin it to the dashboard origin, read from `config`.
14. **Request logger logs on arrival only** - no status, no duration. Move it to
    `res.on("finish")` for a real access log.
15. **`endpoint_metrics.client_id` is an unvalidated string.** No
    `CHECK (client_id ~ '^[0-9a-f]{24}$')`, and no FK is possible (it points at
    a Mongo document). Cross-store integrity is entirely the consumer's job.
16. **The storage split changed again.** Phase 01: Postgres = accounts. Phase 02:
    accounts moved to Mongo. Phase 04: Postgres = analytics rollups, Mongo = raw
    hits + accounts. A dated correction note has been added under Phase 01
    section 3; the diagram there is history, not the current architecture.

### Deferred by design

- `/api/auth`, `/api/hit`, `/api/analytics` are advertised by `GET /` but not
  mounted.
- The consumer process does not exist; nothing writes `endpoint_metrics` or
  drains `api_hits`.
- No rate limiting (`express-rate-limit` still unused), no JWT verify middleware.
- Both Dockerfiles still empty.
- The Phase 01/02 connection-module bugs (`mongodb.js` this-binding and
  singleton export, `logger.js` `winston.combine`, `rabbitmq.js` `getStatus`)
  are now on the critical path - `initializeConnection()` calls straight into
  them.

---

## 6. Commit history for this phase

| Commit | What landed and why |
|---|---|
| `1cb8f56` Learning Logs update | The Phase 03 log (`03-response-envelope-and-error-handling.md`) and its README row. No code. |
| *(uncommitted)* | `server.js` rewritten from stub to a real bootstrap: middleware stack, `/` + `/health`, 404, error handler, connect-before-listen startup, graceful shutdown, process safety nets. `Middleware/errorHandler.js` added: Express 4-arg error middleware mapping Mongoose/JWT errors to a `ResponseFormatter.error` envelope. `init.postgress.sql` filled: `endpoint_metrics` rollup table + indexes + `updated_at` trigger. |

---

## 7. Glossary additions

- **Bootstrap / startup routine.** The code that wires singletons together,
  proves external dependencies are reachable, and only then starts serving.
- **Middleware pipeline.** The ordered chain of `(req, res, next)` functions
  every request passes through; registration order is execution order.
- **Error-handling middleware.** An Express function with the 4-arg signature
  `(err, req, res, next)`, invoked only for errors, registered last.
- **Graceful shutdown.** On a stop signal: refuse new work, let in-flight work
  finish, close connections, exit - instead of dying mid-request.
- **`uncaughtException` / `unhandledRejection`.** Process-level events for errors
  that escaped all `try/catch`. Log and exit; do not resume.
- **Pre-aggregation / rollup table.** Derived summary rows updated as data
  arrives, so reads hit a small table instead of scanning raw events.
- **Time bucket.** A fixed interval (e.g. one hour) that every event in it is
  attributed to; the unit of a rollup row and of a time-series chart point.
- **Upsert.** "Insert, or update if it already exists." In Postgres,
  `INSERT ... ON CONFLICT (unique_key) DO UPDATE` - needs a UNIQUE constraint on
  the key.
- **Idempotent migration.** A schema script safe to run repeatedly, using
  `IF NOT EXISTS` / `OR REPLACE` / `DROP ... IF EXISTS` guards.

---

## 8. Not yet built at the end of this phase

No guess at how later phases will be shaped. The facts, as of this working tree:

- The server does not start (Issue 1). Once it does, the Phase 01/02
  connection-module bugs are in the path (section 5, "Deferred by design").
- `/api/auth`, `/api/hit`, `/api/analytics` are named in the `GET /` response but
  not mounted. No auth, no rate limiting, no JWT verification.
- The consumer process does not exist - nothing drains `api_hits` or writes
  `endpoint_metrics`.
- `init.postgress.sql` is still not wired to run (Issue 6), so
  `endpoint_metrics` is not created on any environment.
- Both Dockerfiles are still empty.

The fix list for what *is* already written is section 5.
