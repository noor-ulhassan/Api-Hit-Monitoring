# 2 · `src/server.js` — the entry point

**Mental model:** the conductor. Build the app, wire the middleware, prove every
datastore is reachable, *then* open the port; on a stop signal, close everything
in order.

---

**What we did.** Phase 1 left `server.js` as an eight-line stub (`"Hi"` on `/`).
This phase makes it a ~130-line entry point with four jobs:

1. build the Express app + middleware chain;
2. serve `GET /` and `GET /health`, plus a catch-all 404;
3. on startup, connect Mongo + Postgres + RabbitMQ **before** binding the port;
4. on a shutdown signal or fatal error, close everything and exit.

## What it does at runtime

- **On boot:** `startServer()` → `await initializeConnection()` (connect Mongo,
  test the Postgres pool, connect RabbitMQ, logging each). Any throw →
  `catch` logs `"Failed to start server"` → `process.exit(1)`; the port never
  opens. All three succeed → `app.listen(config.port)`.
- **Per request:** middleware chain in registration order — `helmet` → `cors` →
  `express.json` / `express.urlencoded` (fill `req.body`) → inline logger (one
  Winston line: method, path, ip, user-agent) → route matching. `/` and
  `/health` return a `ResponseFormatter.success` envelope; anything unmatched
  hits the trailing `app.use` and returns a 404 envelope.
- **On Ctrl-C / container stop:** the `SIGINT` / `SIGTERM` handler runs
  `gracefulShutdown` → `server.close()` → disconnect Mongo / Postgres / RabbitMQ
  → `process.exit(0)`. `uncaughtException` / `unhandledRejection` funnel into the
  same path after logging.

## Why the pieces are shaped this way

- **Connect before listen** — fail-fast on a dead dependency (see
  [1-concepts.md](1-concepts.md)).
- **`helmet()`** — one call, a bundle of hardening headers. Was installed but
  unused since Phase 1; wired in now.
- **`cors()`** — `Access-Control-Allow-*` so a browser dashboard on another
  origin can call the API. No options = allow every origin — fine locally, too
  open for production (Issue). *(Also: used but never imported — fixed Phase 5.)*
- **`express.json()` + `express.urlencoded({ extended: true })`** — turn a JSON
  or form body into `req.body`. Without them `req.body` is `undefined`.
- **The inline request logger** — a homemade access log; it logs on *arrival*,
  so no status code or duration (Issue — should log from `res.on("finish")`).
- **`/health`** — returns `status`, `process.uptime()`, a timestamp — the shape a
  probe expects (but does no real dependency check — Issue).
- **404 as trailing middleware, not a route** — `app.use` with no path after all
  routes. It formats its own response instead of `next(new AppError(...))`, so
  the 404 body and the error body are built in two places and can drift (Issue).
- **Graceful shutdown** turns the Phase 1 `close()` methods into a real
  lifecycle. No timeout guard (Issue).
- **`uncaughtException` / `unhandledRejection`** — the last net for a bug that
  escaped every `try/catch`: log, then exit through `gracefulShutdown`.

This file is the **first real consumer of `ResponseFormatter`**. `AppError`
still has none.
