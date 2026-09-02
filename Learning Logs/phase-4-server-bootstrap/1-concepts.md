# 1 · Concepts

Two clusters: how a Node server should start and stop, and how a rollup table
works.

---

## Bootstrap order: connect first, listen last

`startServer()` `await`s `initializeConnection()` (connect Mongo, test the
Postgres pool, connect RabbitMQ) **before** `app.listen()`. If any step throws,
the process logs and `process.exit(1)` — **it never begins listening**.

Why: if a datastore is unreachable you want the crash on boot, loud and
immediate — not a server that looks healthy to the load balancer while returning
500 on every request. Same fail-fast instinct as Phase 1's Postgres boot smoke
test, applied to the whole process. *Do not open the shop doors until the lights
and the registers work.*

## Middleware order is execution order

Express runs `app.use` handlers top to bottom, so the chain is chosen on
purpose:

```
helmet   → cors → express.json / urlencoded → request logger → routes → 404 → errorHandler
(headers)  (CORS)  (fill req.body)             (access log)              (last)
```

Mount a body parser *after* a route that reads `req.body` and that route
silently sees `undefined` — the usual way this goes wrong.

## Graceful shutdown

On `SIGINT` (Ctrl-C) / `SIGTERM` (container stop): `server.close()` (stop
accepting new connections, wait for in-flight ones), then in the callback
disconnect Mongo / Postgres / RabbitMQ, then `process.exit(0)`. The alternative
— letting the process be killed outright — drops responses mid-write and can
leave AMQP channels and DB transactions half-open. *Finish the conversation
you're in, then hang up.*

## Process-level safety nets

`uncaughtException` / `unhandledRejection` handlers catch a bug that escaped
every `try/catch`: log, then exit through `gracefulShutdown`. Node's own
guidance is to exit after `uncaughtException`, not resume — this does exit,
though running the full async shutdown from an already-corrupt process is itself
fragile (Issue).

---

## Pre-aggregation: why a rollup table exists

Answering "hits per hour for `/orders` last week, with average latency" by
scanning millions of raw `ApiHits` documents on every dashboard load does not
scale. The fix: **compute the answer once, as data arrives, and store the
summary.** Dashboards read a small indexed table; raw hits are still kept 30
days for questions the fixed buckets can't answer.

## Time bucketing

A hit at 10:25 is attributed to the **10:00** bucket. Every hit that hour
updates one row. `time_bucket` stores the *start* of the interval. Coarser
buckets = fewer rows, less storage, less precision — how you get "usage over
time" charts without one point per request.

## Upsert via a UNIQUE constraint

`UNIQUE(client_id, service_name, endpoint, method, time_bucket)` is not only an
integrity rule — it's the **target of an upsert**:
`INSERT ... ON CONFLICT (those columns) DO UPDATE SET total_hits = total_hits +
1, ...`. With no unique constraint on the grouping key, `ON CONFLICT` has
nothing to match and "increment the existing bucket" becomes a read-then-write
race.

## SQL has no automatic timestamps

Mongoose gives `createdAt` / `updatedAt` for free with `timestamps: true`. Raw
SQL does not — so a `BEFORE UPDATE ... FOR EACH ROW` trigger sets
`NEW.updated_at = CURRENT_TIMESTAMP` on every write. `created_at` needs only its
column `DEFAULT`.

## Idempotent init script

Every statement re-runnable: `CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
`DROP TRIGGER IF EXISTS` before `CREATE TRIGGER` — because a container init
script can run on every boot and must not error the second time.
