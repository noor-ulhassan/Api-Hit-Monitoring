# Glossary

Every term used across the logs, defined once. Grouped by area. The phase where
it first mattered is in brackets.

---

## Configuration & process

- **Twelve-Factor config** *(P1)* — environment-varying settings live in env
  vars, read through one boundary (`config/index.js`). No secrets in code.
- **Singleton** *(P1)* — one instance for the process lifetime, shared by every
  caller. `export default new TheClass()`; Node's module cache runs the body
  once. Used for the logger and every DB/broker client.
- **Fail-safe default** *(P3/P4)* — when information is missing, choose the
  option that makes failure visible and safe: HTTP 500, not 200.
- **Bootstrap / startup routine** *(P4)* — the code that wires singletons
  together, proves external dependencies are reachable, and only then starts
  serving.
- **Graceful shutdown** *(P1/P4)* — on `SIGINT`/`SIGTERM`: stop taking new work,
  let in-flight work finish, close pools/connections, exit.
- **`uncaughtException` / `unhandledRejection`** *(P4)* — process-level events
  for errors that escaped every `try/catch`. Log and exit; do not resume.

## Data & storage

- **Connection pooling** *(P1)* — a fixed set of reusable DB connections instead
  of one per request; caps backend load, removes handshake cost from the hot
  path.
- **Message queue / async processing** *(P1)* — a broker between "accept work"
  and "do work" so the two run at different speeds and fail independently.
- **Backpressure** *(P1)* — when downstream is slow, work buffers in the queue
  instead of erroring upstream.
- **Eventual consistency** *(P1)* — the cost of async: data is correct soon, not
  instantly. Fine for analytics, not for money.
- **Dead Letter Queue (DLQ)** *(P1)* — a holding area for messages that cannot be
  processed, so failures are inspectable and replayable, not lost.
- **Polyglot persistence** *(P1)* — more than one database, each chosen for the
  data shape it serves best.
- **Parameterised query** *(P1)* — pass user data as query parameters (`$1`),
  never string concatenation — prevents SQL injection.
- **Healthcheck** *(P1/P5)* — a cheap check of whether a service can actually do
  its job; orchestrators and load balancers use it. In Compose,
  `depends_on: { condition: service_healthy }` makes one service wait for
  another's healthcheck.
- **ODM (Object Document Mapper)** *(P2)* — app-side schema, validation, hooks,
  and reference resolution over a schemaless store (Mongoose over MongoDB).
- **Validation layering** *(P2)* — structural rules in the schema; field
  predicates in `validate` functions; reusable policy in a standalone class.
- **Middleware ordering (Mongoose)** *(P2)* — `pre('validate')` → validation →
  `pre('save')` → write. Lets a plaintext password be checked, then hashed, in
  one `save()`.
- **Password hashing at rest** *(P2)* — bcrypt with a per-password salt and a
  tunable cost factor; compare, never decrypt.
- **Multi-tenancy partition key** *(P2)* — one `clientId` on every tenant-owned
  document; first field of nearly every index; the axis of every access check.
- **Compound index prefix rule + ESR** *(P2)* — an index on `(a,b,c)` serves
  left prefixes only; order fields **E**quality, then **S**ort, then **R**ange.
- **TTL index** *(P2)* — a dated field + `expireAfterSeconds`; a background
  thread deletes expired documents. Used for disposable raw hits (30 days).
- **Public identifier vs primary key** *(P2)* — a separate app-level id so the
  database `_id` stays out of URLs, logs, and message payloads.
- **Soft delete** *(P2)* — `isActive: false` instead of removing a row, to keep
  history and referenced-by integrity.
- **Pre-aggregation / rollup table** *(P4)* — derived summary rows updated as
  data arrives, so reads hit a small table instead of scanning raw events.
- **Time bucket** *(P4)* — a fixed interval (e.g. one hour) that every event in
  it is attributed to; the unit of a rollup row and a time-series chart point.
- **Upsert** *(P4)* — "insert, or update if it already exists". In Postgres
  `INSERT ... ON CONFLICT (unique_key) DO UPDATE` — needs a UNIQUE constraint on
  the key.
- **Idempotent migration** *(P4)* — a schema script safe to run repeatedly:
  `IF NOT EXISTS` / `OR REPLACE` / `DROP ... IF EXISTS` guards.
- **First-init-only** *(P5)* — stateful images (Postgres, MySQL...) run setup
  (`initdb`, `POSTGRES_PASSWORD`, `/docker-entrypoint-initdb.d`) only when the
  data volume is empty. Later changes to those do nothing until the volume is
  recreated.

## HTTP & errors

- **Response envelope** *(P3)* — a fixed outer object (`success`, `data`/`error`,
  `message`, `timestamp`) around every reply, so clients parse one structure.
- **Operational error** *(P3)* — one you anticipated and handle on purpose (not
  found, bad input, upstream timeout). Safe to report; process stays healthy.
- **Programmer error / bug** *(P3)* — an unanticipated error. Not safely
  recoverable: log it, send a generic 500, restart in production.
- **`isOperational` flag** *(P3)* — the boolean on `AppError` that lets one
  central handler tell a deliberate error from a bug.
- **Error-handling middleware** *(P3/P4)* — an Express function with the 4-arg
  signature `(err, req, res, next)`, invoked only for errors, registered last.
- **Middleware pipeline** *(P4)* — the ordered chain of `(req, res, next)`
  functions every request passes through; registration order is execution order.

## Docker

- **Image layer / build cache** *(P5)* — each Dockerfile instruction is a cached
  layer; a layer and everything downstream rebuilds when its inputs change.
  Order cheap-and-stable steps before expensive-and-volatile ones.
- **`.dockerignore`** *(P5)* — excludes paths from the build context so `COPY`
  cannot pick them up; keeps images small and secrets out.
- **Compose profile** *(P5)* — a tag on a service that keeps it out of the
  default `up`; it starts only when its profile is explicitly requested. Used to
  ship a not-yet-active service.
- **Bind mount** *(P5)* — maps a host path into a container. If the host path
  does not exist, the daemon creates it *as a directory*.
- **Exec-form `CMD`** *(P5)* — `CMD ["node","x.js"]` (not `CMD node x.js`) — runs
  the binary as PID 1 with no shell, so `SIGTERM` reaches it directly.

## Architecture (Phase 6)

- **Layered architecture** — code split into Router / Controller / Service /
  Repository, each depending only downward. A layer never calls up or into a
  sibling's internals.
- **Repository pattern** — a class exposing intent-named data methods
  (`findByEmail`) so callers never write query syntax; the seam that lets the
  datastore be swapped or faked.
- **Service layer** — where business rules and decisions live, with no knowledge
  of HTTP or the ODM.
- **Controller** — the HTTP adapter: request in → one service call → response
  out; carries no business rule.
- **Abstract base class (as interface)** — a class whose methods throw
  "not implemented", used where the language has no `interface` keyword.
- **Dependency Injection / Inversion of Control** — a class declares the
  dependencies it needs (constructor arguments) instead of constructing them;
  something external supplies them.
- **Composition root** — the single place that knows the concrete wiring and
  builds the object graph (`Dependencies/dependencies.js`).
- **Higher-order middleware / middleware factory** — a function called with
  configuration that *returns* an `(req, res, next)` handler closed over that
  config (`authorize(roles)`).
- **Authentication vs authorization** — authentication = "who are you" (verify
  the token, set `req.user`); authorization = "are you allowed" (check
  `req.user.role`).
- **Stateless token (JWT)** — a signed credential carrying identity and claims
  in its payload, so a protected request needs no server-side session lookup.
- **httpOnly cookie** — a cookie the browser will not expose to page
  JavaScript, so an XSS bug cannot read the token out of it.
- **Feature-first (vertical slice) layout** — folders grouped by feature with
  layers inside (`services/auth/{controller,service,...}`), versus layer-first
  (`controllers/`, `services/` with a file per feature in each).
- **RBAC vs capability flags** *(P2/P6)* — a coarse role enum vs fine-grained
  boolean permissions. The `User` model has both and reconciles neither.
