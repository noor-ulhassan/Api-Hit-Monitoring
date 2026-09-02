# Phase 4 — Server bootstrap, error middleware, and the analytics rollup

**One line:** turn a pile of modules into a running process, and give analytics a
fast store.

**Commits:** `b454598` (code), `04c104e` (logs)  **Date:** 29 Aug 2026

**State after this phase:** `server.js` is a real bootstrap — Express app,
middleware chain, `/` + `/health`, connect-all-datastores-before-listen,
graceful shutdown. It does **not start as written** (`cors` used but not
imported — fixed Phase 5). No feature routes. The consumer does not exist, so
nothing writes the new Postgres table.

---

## Files this phase touched

```
server/
├─ src/server.js                       stub → ~130-line entry point
├─ src/shared/Middleware/errorHandler.js   NEW — the one (err,req,res,next)
└─ scripts/init.postgress.sql          empty → endpoint_metrics rollup table
```

## Read in this order

1. **[1-concepts.md](1-concepts.md)** — connect-before-listen, middleware order,
   graceful shutdown, process safety nets; then rollup tables, time buckets,
   upsert-via-UNIQUE, the `updated_at` trigger, idempotent migrations.
2. **[2-server-js.md](2-server-js.md)** — the entry point, walked through boot /
   per-request / shutdown.
3. **[3-error-middleware.md](3-error-middleware.md)** — the one place that turns
   a thrown error into a response.
4. **[4-analytics-rollup-table.md](4-analytics-rollup-table.md)** —
   `endpoint_metrics` in PostgreSQL, column by column.

## The gist

- **Connect before listen.** If a datastore is down, crash on boot — don't serve
  500s while looking healthy to the load balancer.
- **Middleware order = execution order.** helmet → cors → body parsers → logger →
  routes → 404 → error handler (last).
- **Graceful shutdown** turns the Phase 1 `close()` methods into a real
  lifecycle: refuse new work, drain in-flight, close connections, exit.
- **The error middleware is the 4-arg `(err, req, res, next)`** — invoked only on
  a thrown/`next(err)` error, registered last, formats with `ResponseFormatter`.
- **PostgreSQL comes back with a new job:** `endpoint_metrics`, a pre-aggregated
  rollup — one row per (client, service, endpoint, method, **hour**), with
  running counts and latency stats. Dashboards read this small table instead of
  scanning millions of raw hits.
- **`UNIQUE(...)` on the grouping columns is an upsert target** —
  `INSERT ... ON CONFLICT ... DO UPDATE`.

## Issues opened here

16 items — see [../OPEN-ISSUES.md](../OPEN-ISSUES.md). Headliners: `cors` not
imported (fixed Phase 5); `errorHandler` reads `req.statusCode` instead of
`err.statusCode`; the 404 handler self-responds so the error middleware is
unreachable; `AppError` still has no consumer; the SQL filename is still
misspelled vs the compose mount (fixed Phase 5).
