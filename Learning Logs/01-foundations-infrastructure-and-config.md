# 01 - Foundations, Infrastructure, and Configuration

**Covers commits:** `5aa9a12` (first commit) through `1d2f210` (Rabbit MQ file
completed).
**Date range of work:** 14 Jul 2026 - 24 Jul 2026.
**State of the app at end of this phase:** infrastructure and connection code
exist and are understood; nothing is wired together yet. `server.js` still
returns a hard-coded `"Hi"`. The model files exist as empty placeholders.

The code is in git. This file is for the reasoning that is not: why each piece
exists, why it is shaped the way it is, and what was traded away.

---

## 1. Scope

This phase builds the skeleton every later feature depends on:

- The product concept and the high-level architecture.
- The repository layout and why it is split the way it is.
- Local infrastructure via Docker Compose: PostgreSQL, MongoDB, RabbitMQ,
  pgAdmin.
- The configuration layer (`src/shared/config/index.js`) - one typed object,
  fed by environment variables.
- Structured logging with Winston.
- Connection modules for MongoDB, PostgreSQL, and RabbitMQ, each written as a
  Singleton with lifecycle methods (connect, health check, graceful close).

No business logic, no routes, no authentication yet.

---

## 2. The product: what we are building

An **API hit monitoring tool**. A smaller, self-hosted version of what services
like RapidAPI analytics, Moesif, or an API gateway dashboard do.

The intended flow, once complete:

1. A **client** (an organisation or developer) registers.
2. They create one or more **API keys**.
3. Their backend calls our ingest endpoint on every request they want tracked,
   passing their API key.
4. We record each call as an **API hit**: which key, route, method, status code,
   response time, timestamp, maybe IP and user agent.
5. We expose **analytics**: totals, per-key, per-route, error rates, latency,
   usage over time, plus rate-limit enforcement.

**Why the architecture below looks heavier than a CRUD app:** two properties of
this problem force it.

- **Write volume that never stops.** Hit events arrive continuously. The ingest
  path must accept a hit and return in a few milliseconds without waiting on a
  database.
- **Two data shapes that pull in opposite directions.** Accounts, keys, and
  permissions are relational and must be consistent. Hit events are a huge,
  append-only stream that is mostly read as aggregates. One database engine
  cannot be great at both.

---

## 3. Architecture overview

```
                 ┌─────────────────────────────────────────────┐
   HTTP clients  │                 PRODUCER                     │
  ───────────────▶  Express API (src/server.js + modules)       │
                 │   - auth, validation, rate limiting          │
                 │   - writes account/key data to PostgreSQL    │
                 │   - publishes each hit event to RabbitMQ     │
                 └───────────────┬─────────────────────────────┘
                                 │  (a small JSON message per hit)
                                 ▼
                         ┌───────────────┐        ┌──────────────────┐
                         │   RabbitMQ    │        │  api_hits.dlq    │
                         │  queue:       │───────▶│  (dead letters)  │
                         │  api_hits     │  fail  └──────────────────┘
                         └───────┬───────┘
                                 │  (consumer pulls messages)
                                 ▼
                 ┌─────────────────────────────────────────────┐
                 │                 CONSUMER                     │
                 │   Worker process (own Dockerfile.consumer)   │
                 │   - reads messages, batches them             │
                 │   - writes hit events to MongoDB             │
                 │   - acks on success, nacks to DLQ on failure │
                 └─────────────────────────────────────────────┘

   PostgreSQL  ── relational source of truth: users, clients, api_keys
   MongoDB     ── high-volume append-only store: api_hits events + aggregates
   pgAdmin     ── browser UI to inspect PostgreSQL during development
```

### Why a message queue sits in the middle

The naive design does `INSERT` on every ingest request. That ties your API's
latency and uptime to your database's: if the database is slow or briefly down,
every client call fails, and a traffic spike on ingest becomes a traffic spike
of writes with no buffer.

Putting RabbitMQ between "accept the hit" and "store the hit" buys four things:

- **A fast hot path.** The producer publishes a small message and returns.
  Publishing is cheap and in-memory on the broker.
- **Backpressure instead of failure.** If the consumer or MongoDB slows down,
  messages accumulate in the queue (a bounded buffer) rather than errors
  propagating back to clients.
- **Independent scaling and deploys.** Restart the consumer, or run five of
  them, without touching the API. They share only the message format.
- **No silent data loss.** A message that cannot be processed is dead-lettered
  for inspection and replay, not dropped.

The price you accept is **eventual consistency**: a hit is queryable a short
time after it is received, not instantly. That is fine for analytics; it would
not be fine for, say, account balances.

### Why two databases (polyglot persistence)

| Need | Engine | Why |
|------|--------|-----|
| Users, clients, API keys, permissions | PostgreSQL | Low write rate, correctness critical, relational joins, transactions, unique constraints (e.g. on key hashes). |
| API hit events, usage aggregates | MongoDB | Very high write throughput, schema that drifts over time, self-contained documents, no joins, natural fit for time-bucketed aggregates and TTL expiry of raw events. |

Using the right engine per shape is cheaper than bending one engine to do both.
The cost is operational: two datastores to run, back up, and monitor.

---

## 4. Repository layout

```
Api-Hit-Monitoring/
├─ README.md                       one-line placeholder for now
├─ .gitignore                      ignores node_modules and .env
├─ Learning Logs/                  this folder
└─ server/
   ├─ .env                         local secrets/config, NOT committed
   ├─ package.json                 dependencies, "type": "module" (ESM)
   ├─ docker-compose.yaml          local infra: postgres, mongo, rabbitmq, pgadmin
   ├─ Dockerfile                   image for the producer (API) - empty so far
   ├─ Dockerfile.consumer          image for the consumer (worker) - empty so far
   ├─ scripts/
   │  └─ init.postgress.sql        schema bootstrap for postgres - empty so far
   ├─ logs/
   │  └─ log.js                    placeholder; Winston writes error.log/combined.log here
   └─ src/
      ├─ server.js                 API entry point - still a stub
      └─ shared/
         ├─ config/
         │  ├─ index.js            the single config object
         │  ├─ logger.js           Winston logger
         │  ├─ mongodb.js          MongoConnection class
         │  ├─ postgres.js         postgresConnection singleton
         │  └─ rabbitmq.js         RabbitMqConnection singleton
         └─ models/
            ├─ User.js  Client.js  ApiKey.js  ApiHits.js   (all empty for now)
```

### Why this structure

- **`src/shared/` exists because two processes share one codebase.** The
  producer and the consumer both need config, the logger, the DB clients, and
  the models. Those belong to neither process, so they do not live under a
  `producer/` or `consumer/` folder. When feature modules arrive they will sit
  next to `shared/`, not inside it.
- **`config/` is the only place allowed to read `process.env`.** Centralising it
  means one file to audit for missing settings, one file to change when a
  setting is renamed, and no scattered `process.env.X` with slightly different
  defaults in each caller. This is the Twelve-Factor "config" rule: config comes
  from the environment, through one boundary.
- **Two Dockerfiles because they are two processes.** Same code, different entry
  point, different scaling profile (the API scales with request traffic, the
  consumer with queue depth). Separate images keep those independent.
- **`models/` is stubbed now** so imports and folder intent exist before the
  schemas are written.

---

## 5. Tooling and dependencies

Runtime is **Node.js 24** using **ES Modules** (`"type": "module"` in
`package.json`, so `import`/`export`).

| Package | Role | Why it was chosen / noted |
|---------|------|---------------------------|
| `express` `^5` | HTTP framework | Express 5 is current; async errors reach error middleware without manual `try/catch` forwarding. |
| `mongoose` | MongoDB ODM | Schema + validation layer; we want structure over the raw driver for the event model. |
| `pg` | PostgreSQL driver | Used directly with a `Pool`, no ORM - the relational surface is small and hand-written SQL keeps it obvious. |
| `amqplib` | RabbitMQ (AMQP 0-9-1) client | Low-level on purpose: we manage connections, channels, queues, and acks so the reliability behaviour is explicit. |
| `winston` | Logging | Structured JSON, level thresholds, multiple transports. |
| `dotenv` | Loads `.env` into `process.env` | Dev convenience only; production sets real env vars. |
| `bcryptjs` | Hashing | Will hash user passwords and API keys at rest. Pure JS, no native build step. |
| `jsonwebtoken` | JWT sign/verify | Dashboard session tokens. |
| `cors` | Cross-origin headers | Needed once a browser frontend calls the API. |
| `helmet` | Security headers | Sane defaults (HSTS, no-sniff, frameguard). |
| `express-rate-limit` | Throttling | Protects the API and enforces per-key limits. |
| `uuid` | ID generation | Public IDs, correlation IDs. |
| `nodemon` (dev) | Auto-restart | `npm run dev`. |

Half of these (`helmet`, `cors`, `express-rate-limit`, `bcryptjs`,
`jsonwebtoken`, `uuid`) are installed but unused so far. They are a stated plan,
not current behaviour.

### Infrastructure (docker-compose.yaml)

| Service | Image | Host port | Purpose |
|---------|-------|-----------|---------|
| `postgres` | `postgres:15-alpine` | 5432 | Relational store. Healthcheck `pg_isready`, named volume `postgres_data`, tries to run `scripts/init.postgres.sql` on first boot. |
| `mongo` | `mongo:6.0` | **27018** → 27017 | Event store. Named volume `mongo_data`. No healthcheck yet. |
| `rabbitmq` | `rabbitmq:3-management-alpine` | 5672 (AMQP), 15672 (UI) | Broker. User `admin`, pass `12345`, vhost `api_monitoring`. Healthcheck `rabbitmq-diagnostics ping`. |
| `pgadmin` | `dpage/pgadmin4:7` | 5050 → 80 | Browser UI for PostgreSQL. `depends_on: postgres`. |

All on one bridge network so they resolve each other by service name; all
`restart: unless-stopped`.

**Why these choices:**

- **Named volumes** persist data across `docker compose down`. Without them
  every recreation wipes the databases - a common early mistake.
- **Healthchecks** report readiness, not just "process started". `depends_on`
  alone only orders startup; it does not wait for a database to accept
  connections unless paired with `condition: service_healthy`.
- **`27018:27017` port remap** avoids colliding with a MongoDB already installed
  on the host. The container still speaks 27017 internally.
- **Alpine images** for smaller pulls; `postgres:15` pinned (not `latest`) so
  the environment is reproducible.

---

## 6. The configuration layer - `src/shared/config/index.js`

One module exports one object. Sections: `node_env`, `port`, `mongo`,
`postgres`, `rabbitmq`, `jwt`, `ratelimit`. Every value is
`process.env.X || default`, and every numeric value is wrapped in
`parseInt(..., 10)`.

**Why it is built this way:**

- **One import boundary.** Everything else does
  `import config from ".../config/index.js"`. A grep for `process.env` should
  only ever hit this file. That makes "which settings does this app need?" a
  one-file question.
- **Defaults are the local-dev values**, chosen to line up with the compose
  file, so a fresh clone runs with an almost-empty `.env`. (They do not line up
  perfectly yet - see Issues 9-11.)
- **`parseInt(x, 10)` at the boundary.** Env vars are always strings. Passing
  `"5432"` where `pg` expects `5432` causes quiet type bugs later. Parse once,
  here. Radix `10` avoids any legacy octal reading of a leading zero.
- **Booleans need coercion.** `process.env.RABBITMQ_PUBLISHER_CONFIRMS === "true"`
  turns the string into a real boolean; the string `"false"` is truthy
  otherwise.
- **Retry knobs (`retryAttempts`, `retryDelay`) are declared before the retry
  code exists.** Writing the config first is a way of committing to the plan:
  RabbitMQ will get bounded reconnect-with-backoff.

### `.env` today (not committed)

Only `NODE_ENV`, `PORT`, `MONGO_DB_NAME`, `MONGO_URI`, `JWT_SECRET` are set.
Postgres and RabbitMQ run entirely on code defaults right now.

### Secrets

- `.env` is git-ignored, so real secrets stay off GitHub. Correct.
- The **in-code fallback secrets** (`password`, `noorulhassan1`) are acceptable
  for local dev only. The hardening rule for later: in production, a missing
  `JWT_SECRET` (or DB password) should make the process **refuse to start**, not
  silently fall back to a known default. That means replacing `|| "default"`
  with a startup assertion for the critical ones.

---

## 7. Structured logging - `src/shared/config/logger.js`

A Winston logger: level `info` in production and `debug` otherwise; JSON format
with timestamp, error stacks, and printf interpolation; `defaultMeta` of
`{ service: "api-monitoring" }`; file transports for `logs/error.log`
(error-only) and `logs/combined.log`; plus a colourised console transport when
not in production.

**Why not `console.log`:**

- **Levels with a threshold.** `debug` calls stay in the code but vanish in
  production because the threshold is `info`. No commenting-out, no redeploy to
  change verbosity.
- **JSON in files.** Every line is an object with `timestamp`, `level`,
  `message`, `service`, and any metadata attached at the call site. That is the
  format a log aggregator (Loki, ELK, CloudWatch, Datadog) ingests. Plain text
  is not searchable across many processes.
- **`format.errors({ stack: true })`** keeps the stack trace when an `Error`
  object is logged, instead of it collapsing to `{}`.
- **`defaultMeta.service`** tags every line so producer and consumer logs remain
  distinguishable once they land in the same place. The consumer will later
  override this with its own service name.
- **Separate transports** = separate output destinations with their own level.
  `error.log` is the "what broke" file; `combined.log` is the full record.

In a real deployment you would usually log only to stdout and let the platform
collect it; the file transports are a convenience for the tutorial phase and do
no harm.

---

## 8. Database connections - why they are all Singletons

All three modules share one goal: **the process holds exactly one connection (or
pool) per backend, created on first use and reused everywhere after.**

**Why:**

- A TCP connect + auth handshake is expensive. Doing it per request destroys
  throughput.
- Pools and AMQP channels are explicitly designed to be long-lived and shared.
- Lifecycle needs one owner: something has to connect on boot and close on
  shutdown.

**How, in JavaScript:** a class, then `export default new TheClass()`. Node's
module cache runs a module body once, so every importer gets the same instance.
(`mongodb.js` currently exports the class, not an instance - Issue 3.)

---

### 8a. PostgreSQL - `src/shared/config/postgres.js`

Exports a singleton with `getPool()`, `testConnection()`, a timed `query()`
wrapper, and `close()`. The pool is created lazily with `max: 20`,
`idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 2000`.

**Why each decision:**

- **A pool, not a single connection.** `pool.query()` borrows a free client,
  runs the query, returns it. Concurrent queries use different clients up to the
  cap.
- **`max: 20` is a real capacity decision.** Too low and the app starves under
  load (queries queue, then time out after `connectionTimeoutMillis`). Too high
  and you exhaust PostgreSQL's own `max_connections`, which is shared across
  every client and every app instance. 20 per instance is a conservative
  starting point to tune later.
- **`idleTimeoutMillis`** hands resources back when traffic drops so idle
  instances do not pin 20 connections each.
- **`pool.on("error", ...)`** handles errors on *idle* clients (e.g. the
  database closed the socket). Without this listener, that error is unhandled
  and crashes the process.
- **`testConnection()` runs `SELECT NOW()` at boot** - a smoke test so the app
  fails fast on a bad DB config instead of on the first user request. It calls
  `client.release()`; a borrowed client that is never released is a permanent
  pool leak, and forgetting `release()` is the classic `pg` bug.
- **`query()` wraps every call with timing** and logs duration + row count, so
  slow queries are visible from day one. It takes `(text, params)` -
  parameterised queries (`$1`, `$2`) are the defence against **SQL injection**;
  user input must never be concatenated into the SQL string.
- **`close()`** drains the pool for graceful shutdown.

Note: this file's comments are in Roman-Urdu/Hinglish. Pick one language for
comments project-wide and convert whole files at once, not line by line.

---

### 8b. MongoDB - `src/shared/config/mongodb.js`

A `MongoConnection` class with `connect()`, `disconnect()`, `getConnection()`.

**Intended reasoning:**

- Mongoose keeps its own internal pool; you call `mongoose.connect()` once per
  process.
- `dbName` is passed as an option rather than baked into the URI, so the URI
  stays environment-neutral.
- Connection **event listeners** (`error`, `disconnected`, `close`) are how you
  would later drive a health endpoint or alerting - you want to know the link
  dropped before users tell you.

**This file has real bugs and is not usable as written** - see Issues 1-3. In
short: `this.connection` is never assigned (should be `mongoose.connection`), so
the listener setup throws; the event name casing is wrong; and it exports the
class instead of a singleton, breaking the pattern the other two files follow.
It is documented here so the fix is not forgotten.

---

### 8c. RabbitMQ - `src/shared/config/rabbitmq.js`

The most developed file; it grew over four commits
(`5652c1c` → `629f1dc` → `1d2f210`). Exports a singleton with `connect()`,
`getChannel()`, `getStatus()`, `close()`.

**The AMQP concepts, and why they matter here:**

- **Connection vs channel.** One TCP **connection** to the broker; inside it,
  cheap **channels** carry the actual operations. Convention: one connection per
  process, one channel per concurrent unit of work. We keep a single shared
  channel because the producer's job (publish one message) is simple.
- **`assertQueue` is idempotent** - creates the queue if absent, verifies it
  matches if present - so it is safe to call on every boot. No separate
  migration step for queue topology.
- **`durable: true`** makes the queue *definition* survive a broker restart.
  (Messages also surviving requires publishing them as persistent - a producer
  concern for a later commit.)
- **Dead Letter Queue.** `api_hits` is declared with
  `x-dead-letter-exchange: ""` and `x-dead-letter-routing-key: "api_hits.dlq"`.
  The reasoning: when the consumer rejects a message it cannot process
  (`nack`/`reject` with `requeue: false`), RabbitMQ must not drop it. With this
  wiring the broker automatically routes it to `api_hits.dlq`, where you can
  inspect poison messages and replay them after a fix. Declaring the DLQ *and*
  the main queue at connect time means the safety net exists before the first
  message is ever published.

**Why the `isConnecting` guard exists.** During startup two code paths could
call `connect()` almost simultaneously and each open a connection + channel. The
guard is a hand-rolled mutex: the first caller sets `isConnecting = true` and
proceeds; a second caller sees the flag and polls every 100 ms until it clears,
then returns the now-ready channel. A cleaner version caches the in-flight
promise and returns it to concurrent callers - worth switching to later - but
the intent (exactly one connection) is right.

**Why the `close`/`error` handlers null out `connection` and `channel`.** They
make the *next* `connect()` call rebuild cleanly. This is deliberately passive:
it does not auto-reconnect, it just avoids handing back a dead channel. Active
reconnect-with-backoff, using the `retryAttempts` / `retryDelay` config already
defined, is still to be written.

**`close()`** closes the channel then the connection, in that order, for
graceful shutdown.

---

## 9. System-design concepts introduced this phase

Anchored definitions:

- **Twelve-Factor config.** Environment-varying config lives in env vars, read
  through one boundary. No secrets in code, no `if (env === "prod")` sprinkled
  around.
- **Singleton.** One instance for the process lifetime, shared by all callers.
  Used for logger and every DB/broker client.
- **Connection pooling.** A fixed set of reusable connections instead of one per
  request; caps load on the backend, removes handshake cost from the hot path.
- **Message queue / async processing.** A broker between "accept work" and "do
  work" so the two run at different speeds and fail independently.
- **Decoupling.** Producer and consumer share only a message contract; either
  can be restarted, redeployed, or scaled alone.
- **Backpressure.** When downstream is slow, work buffers in the queue instead
  of overloading downstream or erroring upstream.
- **Eventual consistency.** The cost of async: data is correct soon, not
  instantly. Fine for analytics, not for money.
- **Dead Letter Queue.** A holding area for unprocessable messages so failures
  are inspectable and replayable, not lost.
- **Graceful shutdown.** On `SIGTERM`/`SIGINT`: stop taking new work, finish or
  safely abandon in-flight work, close pools/connections, exit. The `close()`
  methods exist; the signal handlers are a later step.
- **Structured logging.** Machine-parseable lines with levels and metadata, so
  logs are searchable across many processes.
- **Polyglot persistence.** More than one database, each chosen for the data
  shape it serves best.
- **Parameterised queries.** Pass user data as query parameters, never string
  concatenation - prevents SQL injection.
- **Healthcheck.** A cheap check of whether a service can actually do its job,
  used by orchestrators and load balancers.

---

## 10. Issues, shortcuts, and TODO

Blunt list. Bugs found while writing this log, plus things deferred on purpose.

### Bugs to fix before the code is used

1. **`mongodb.js`: `this.connection` is never set.** After
   `await mongoose.connect(...)` the code calls `this.connection.on(...)` while
   it is still `null`, which throws. Fix: `this.connection = mongoose.connection`
   and attach listeners to that. The "already connected" early-return is dead
   for the same reason.
2. **`mongodb.js`: wrong event name.** Mongoose emits `"disconnected"`
   (lowercase); the `"Disconnected"` listener never fires.
3. **`mongodb.js`: exports the class, not an instance.** Should be
   `export default new MongoConnection()` to match `postgres.js` / `rabbitmq.js`
   and actually be a Singleton.
4. **`logger.js`: `winston.combine` is not a function.** In the non-prod console
   transport it must be `winston.format.combine`. As written, adding that
   transport throws in development.
5. **`config/index.js`: `jwt.sercet` typo.** Should be `jwt.secret`; readers get
   `undefined` and fall back silently.
6. **`config/index.js`: `node_env` default `"Development "`** - trailing space,
   capital D. `=== "production"` checks still work; any `=== "development"`
   check fails. Normalise to lowercase `"development"`.
7. **`rabbitmq.js`: `getStatus()` reads `this.connect`** (the method) instead of
   `this.connection`, so it never reports `DISCONNECTED` correctly.
8. **`rabbitmq.js`: the `connection.on("error")` handler ignores `err`** - state
   is nulled but nothing is logged, so a broker error is invisible.

### Config / infra mismatches

9. **Mongo port.** Compose publishes 27018; `.env` and the code default use
   27017. Set `MONGO_URI` to `...:27018/...` or remap compose to `27017:27017`
   if you want to use the compose MongoDB.
10. **Postgres init script filename.** Compose mounts `init.postgres.sql`; the
    file on disk is `init.postgress.sql` (double "s"). The init never runs. The
    file is also empty - no schema yet.
11. **RabbitMQ URL.** Compose broker needs
    `amqp://admin:12345@localhost:5672/api_monitoring`; the code default
    `amqp://localhost:5672` will fail against it until `RABBITMQ_URL` is set.
12. **`dotenv.config()` is called in both `config/index.js` and `server.js`.**
    Idempotent, so harmless, but consolidate to `config/index.js` only.

### Deferred by design (not bugs)

13. `server.js` is a stub: no config import, no logger, no DB bootstrap, no
    routes, no error middleware, no shutdown handlers.
14. Model files empty - schemas next.
15. Both Dockerfiles empty - containerise the app after it runs locally.
16. No RabbitMQ reconnect/backoff yet, despite the config being ready.
17. No tests, no linter/formatter config, no CI.
18. Mongo has no healthcheck; pgadmin `depends_on` does not wait for postgres
    readiness.

---

## 11. Commit history for this phase

| Commit | What landed and why |
|--------|---------------------|
| `5aa9a12` first commit | Repo skeleton: `.gitignore`, empty Dockerfiles, `docker-compose.yaml`, `package.json` + lock, stub `server.js`, empty `scripts/` and `logs/` placeholders. Establishes the two-process, four-service shape up front. |
| `74bb9ac` Basic Configurations | Fills `config/index.js` - the single typed config object. Everything after this reads settings through it. |
| `cb3baed` Add README file | One-line root README. |
| `8468052` Winston Logger | `config/logger.js` - structured logging in place before any real code needs to log. |
| `3a6ce56` MongoDb Connection using Singleton Design Pattern | `config/mongodb.js` - first connection module; sets the Singleton + lifecycle-methods template (has bugs, see Issues). |
| `a7132fc` Postgres Pool Connection | `config/postgres.js` - pool, boot smoke test, timed query wrapper, graceful close; exported as a true singleton instance. `pg` added. |
| `5652c1c` Rabbit MQ connector File | First `rabbitmq.js`: `connect()` opened only a connection. |
| `629f1dc` Rabbit MQ connector | Adds the `isConnecting` guard, creates a channel, asserts a placeholder `HEALTH_CHECK` queue, exports the singleton. |
| `1d2f210` Rabbit mq file completed | Replaces the placeholder with the real `api_hits` queue + `api_hits.dlq` dead-letter wiring, connection `close`/`error` handlers, `getChannel`, `getStatus`, `close()`. The safety net is defined at connect time, before any publish. |

Uncommitted at time of writing: `server/src/shared/models/` (four empty files)
and this `Learning Logs/` folder.

---

## 12. What comes next (expected)

Roughly the tutorial's likely order:

1. Define schemas: `User`, `Client`, `ApiKey` (PostgreSQL), `ApiHits`
   (MongoDB). Write `scripts/init.postgres.sql` and fix its filename.
2. Fix the `mongodb.js` and `logger.js` bugs above.
3. Turn `server.js` into a real bootstrap: load config, init logger, connect
   PostgreSQL + RabbitMQ, mount middleware (`helmet`, `cors`, `express.json`,
   rate limiter), mount routes, add 404 + error handler, register
   `SIGTERM`/`SIGINT` handlers that call every `close()`.
4. Auth: register/login, password hashing with `bcryptjs`, JWT issue/verify
   middleware.
5. API key management: create/list/revoke, store only a hash of each key.
6. Ingest endpoint: authenticate by API key, validate payload, publish a hit
   message, return `202 Accepted` fast.
7. Consumer process: connect, `consume` `api_hits`, batch-insert into MongoDB,
   `ack` on success, `nack(false, false)` to DLQ on failure. Own entry file +
   `Dockerfile.consumer`.
8. Analytics endpoints: aggregations over the hit collection.
9. RabbitMQ reconnect-with-backoff using the existing retry config.
10. Hardening: required-secret assertions in production, request logging,
    health/readiness endpoints, then fill the Dockerfiles.
