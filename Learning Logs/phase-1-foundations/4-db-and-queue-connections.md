# 4 · The three connection singletons

**Mental model:** each backend (Postgres, Mongo, RabbitMQ) gets exactly one
long-lived connection object for the whole process, created on first use, with a
`connect` / health-check / `close` lifecycle.

---

## Why singletons

The process holds **exactly one connection (or pool) per backend**, created on
first use and reused everywhere.

- A TCP connect + auth handshake is expensive. Doing it per request destroys
  throughput.
- Pools and AMQP channels are *designed* to be long-lived and shared.
- Lifecycle needs one owner — something must connect on boot and close on
  shutdown.

**How, in JS:** a class, then `export default new TheClass()`. Node's module
cache runs a module body once, so every importer gets the same instance.

---

## `postgres.js` — a pooled client

Exports a singleton with `getPool()`, `testConnection()`, a timed `query()`
wrapper, and `close()`. The pool is lazy: `max: 20`, `idleTimeoutMillis: 30000`,
`connectionTimeoutMillis: 2000`.

- **A pool, not one connection.** `pool.query()` borrows a free client, runs the
  query, returns it. Concurrent queries use different clients up to `max`.
- **`max: 20` is a real capacity decision.** Too low → the app starves under
  load (queries queue, then time out). Too high → you exhaust Postgres's own
  `max_connections`, shared across every client and instance. 20 per instance is
  a conservative start.
- **`idleTimeoutMillis`** hands connections back when traffic drops.
- **`pool.on("error", ...)`** handles errors on *idle* clients (e.g. the DB
  closed the socket). Without this listener, that error is unhandled and crashes
  the process.
- **`testConnection()` runs `SELECT NOW()` at boot** — a smoke test so the app
  fails fast on bad DB config instead of on the first user request. It calls
  `client.release()`; a borrowed client never released is a permanent pool leak
  (the classic `pg` bug).
- **`query(text, params)` wraps every call with timing** and logs duration + row
  count. `params` (`$1`, `$2`) are the defence against **SQL injection** — user
  input must never be concatenated into the SQL string.
- **`close()`** drains the pool for graceful shutdown.

*(This file's comments are Roman-Urdu/Hinglish — pick one comment language
project-wide.)*

---

## `mongodb.js` — the Mongoose wrapper

A `MongoConnection` class: `connect()`, `disconnect()`, `getConnection()`.

- Mongoose keeps its own internal pool; you call `mongoose.connect()` **once per
  process**.
- `dbName` is an option, not baked into the URI, so the URI stays
  environment-neutral.
- Connection **event listeners** (`error`, `disconnected`, `close`) are how you
  would later drive a health endpoint or alerting — you want to know the link
  dropped before users tell you.

**As written in Phase 1 this file did not work** — three bugs: `this.connection`
never assigned, wrong event-name casing, exports the class not an instance. All
**fixed in Phase 5**; see [../OPEN-ISSUES.md](../OPEN-ISSUES.md).

---

## `rabbitmq.js` — AMQP connection, channel, and the DLQ

The most-developed file (grew over three commits). Singleton with `connect()`,
`getChannel()`, `getStatus()`, `close()`.

### The AMQP concepts

- **Connection vs channel.** One TCP **connection** to the broker; inside it,
  cheap **channels** carry the actual operations. Convention: one connection per
  process, one channel per concurrent unit of work. We keep a single shared
  channel because the producer's job (publish one message) is simple.
- **`assertQueue` is idempotent** — creates the queue if absent, verifies it
  matches if present — so it is safe to call on every boot. No separate topology
  migration step.
- **`durable: true`** makes the queue *definition* survive a broker restart.
  (Messages surviving too needs them published as persistent — a later concern.)
- **Dead Letter Queue.** `api_hits` is declared with `x-dead-letter-exchange: ""`
  and `x-dead-letter-routing-key: "api_hits.dlq"`. When the consumer rejects a
  message it cannot process (`nack`/`reject`, `requeue: false`), the broker
  routes it to `api_hits.dlq` instead of dropping it — where you can inspect and
  replay poison messages. Declaring the DLQ **and** the main queue at connect
  time means the safety net exists before the first publish.

### The `isConnecting` guard

During startup two code paths could call `connect()` almost simultaneously and
each open a connection + channel. The guard is a hand-rolled mutex: the first
caller sets `isConnecting = true` and proceeds; a second polls every 100 ms
until it clears, then returns the ready channel. A cleaner version caches the
in-flight promise — worth switching to later — but the intent (exactly one
connection) is right.

### The `close` / `error` handlers null out `connection` and `channel`

So the *next* `connect()` rebuilds cleanly. Deliberately passive: it does not
auto-reconnect, it just avoids handing back a dead channel. Active
reconnect-with-backoff (using the `retryAttempts` / `retryDelay` config) is not
written.

### Known bug

`getStatus()` reads `this.connect` (the method) instead of `this.connection`, so
it never reports `DISCONNECTED`. Still open.
