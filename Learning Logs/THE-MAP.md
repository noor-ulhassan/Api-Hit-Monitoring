# THE MAP — how the whole app fits together

Read this to rebuild the entire mental picture in five minutes. Everything else
in `Learning Logs/` is depth on one slice of this page.

---

## 1. What we are building

An **API hit monitoring tool**. Customers ("clients") register, mint API keys,
and call our ingest endpoint on every request their own backend serves. We record
each call (route, method, status, latency, time) and expose analytics: totals,
error rates, latency, usage over time, per key and per route.

Two properties force the design:

- **Writes never stop.** The ingest path must accept a hit and return in
  milliseconds without waiting on a database.
- **Two data shapes.** Accounts/keys need correctness; hit events are a firehose
  read mostly as aggregates. Different storage strategies.

---

## 2. The runtime shape (what talks to what)

```
                          ┌──────────────────────────────┐
   HTTP clients  ─────────▶        PRODUCER (api-app)     │
                          │  Express, src/server.js      │
                          │  • auth / validation / limits│
                          │  • account + key data ──────────► MongoDB
                          │  • one small JSON msg per hit│        (accounts + raw hits)
                          └───────────────┬──────────────┘
                                          │ publish
                                          ▼
                             ┌─────────────────────────┐      ┌───────────────┐
                             │  RabbitMQ  queue:       │─────▶│  api_hits.dlq │
                             │  api_hits               │ fail │  (dead letter)│
                             └───────────┬─────────────┘      └───────────────┘
                                          │ consume
                                          ▼
                          ┌──────────────────────────────┐
                          │   CONSUMER  (own image)      │   ← NOT BUILT YET
                          │  • drain api_hits            │
                          │  • write raw hits → MongoDB  │
                          │  • roll up → PostgreSQL      │
                          └──────────────────────────────┘

   MongoDB      accounts (User/Client/ApiKey) + raw hit events (ApiHit, 30-day TTL)
   PostgreSQL   endpoint_metrics — pre-aggregated per (client, service, endpoint,
                method, hour) rollup rows for fast dashboards
   RabbitMQ     the buffer between "accept a hit" and "store a hit"
   pgAdmin      browser UI onto PostgreSQL, dev only
```

**Why the queue in the middle:** a fast hot path, backpressure instead of
failure, independent scaling/deploys, and no silent data loss (poison messages
dead-letter). The price is eventual consistency — a hit is queryable a moment
after it arrives, which is fine for analytics.

> The storage split changed twice while building. Phase 1 planned Postgres for
> accounts; Phase 2 moved them to Mongo; Phase 4 gave Postgres the rollup job.
> The diagram above is the **current** state.

---

## 3. Every file in `server/src/`, and what it does

```
server/src/
│
├─ server.js ─────────── the PRODUCER entry point. Builds the Express app, mounts
│                        the app-level middleware (cookie-parser, helmet, cors,
│                        body parsers, logger), serves GET / and GET /health,
│                        MOUNTS the auth router at /api/auth, then on boot
│                        connects Mongo+Postgres+Rabbit BEFORE listening, and on
│                        SIGINT/SIGTERM shuts everything down cleanly.
│
├─ shared/ ───────────── code both processes (producer + future consumer) share.
│  │
│  ├─ config/
│  │  ├─ index.js ────── THE config object. The only file allowed to read
│  │  │                  process.env. Sections: node_env, port, mongo, postgres,
│  │  │                  rabbitmq, jwt, ratelimit, cookie. Everything imports this.
│  │  ├─ logger.js ───── Winston logger (singleton). JSON to files, colour to
│  │  │                  console in dev. Every module logs through this.
│  │  ├─ mongodb.js ──── MongoConnection singleton: connect / disconnect /
│  │  │                  getConnection. Wraps mongoose.connect once per process.
│  │  ├─ postgres.js ─── postgres singleton: a pg Pool + testConnection (boot
│  │  │                  smoke test) + timed query() + close.
│  │  └─ rabbitmq.js ─── RabbitMqConnection singleton: one connection + one
│  │                     channel, asserts the api_hits queue + api_hits.dlq
│  │                     dead-letter wiring at connect time.
│  │
│  ├─ constants/
│  │  └─ roles.js ────── the canonical role strings (super_admin / client_admin /
│  │                     client_viewer) + ROLES / CLIENT_ROLES / APPLICATION_ROLES
│  │                     + isValidRole helpers. One place to name a role.
│  │
│  ├─ models/ ────────── Mongoose schemas (shape + rules for each collection).
│  │  ├─ User.js ─────── dashboard accounts. password hashed in a pre('save')
│  │  │                  hook; role enum; permissions block; clientId (required
│  │  │                  unless super_admin).
│  │  ├─ Client.js ───── the tenant. Everything else carries a clientId pointing
│  │  │                  here. settings sub-doc (retention / alerts / timezone).
│  │  ├─ ApiKey.js ───── the credential a client presents on ingest. keyId +
│  │  │                  keyValue, permissions, IP/origin allow-lists, expiry TTL.
│  │  └─ ApiHits.js ──── one flat document per tracked call. Four analytics
│  │                     indexes + a 30-day TTL so the raw collection stays bounded.
│  │
│  ├─ utils/ ─────────── stateless helpers.
│  │  ├─ AppError.js ─── Error subclass carrying { statusCode, errors,
│  │  │                  isOperational }. "the errors you meant to throw."
│  │  ├─ ResponseFormatter.js ─ static builders for ONE JSON envelope shape:
│  │  │                  success / error / validationError / paginated.
│  │  └─ SecurityUtil.js ─ the password policy + validatePassword(pw) →
│  │                     { success, errors[] }. Reusable outside the model.
│  │
│  └─ Middleware/ ────── Express middleware.
│     ├─ errorHandler.js ─ the ONE (err,req,res,next). Right status code, level-
│     │                   aware logging, no message leak on 5xx. Registered last.
│     ├─ authenticate.js ─ read the authToken cookie → verify JWT → req.user.
│     │                   (named export; used by /register and /profile)
│     ├─ authorize.js ─── authorize(roles) → (req,res,next) role gate.
│     │                   (used by /register)
│     ├─ validate.js ──── validate(schema) → (req,res,next). Hand-rolled body
│     │                   check; 400 + errors[] on failure. (P7)
│     └─ requestLogger.js  res.on("finish") access log: method, url, ip,
│                        status, duration. (P7)
│
└─ services/ ─────────── one folder per FEATURE, layers inside. Feature-first.
   └─ auth/ ──────────── the only feature. MOUNTED at /api/auth as of P7.
      ├─ routes/
      │  └─ authRouter.js ── 5 routes, each a path + verb + middleware chain →
      │                      a controller method. Only onboard-super-admin has a
      │                      working controller method; the other 4 → 500.
      ├─ controller/
      │  └─ authController.js ─ the HTTP adapter: read req.body → ONE service call
      │                        → set cookie + ResponseFormatter envelope.
      │                        ONLY has onboardSuperAdmin; register/login/
      │                        getProfile/logout are missing (P7 issue).
      ├─ service/
      │  └─ authService.js ─── the business rules: onboardSuperAdmin ("one super
      │                        admin ever"), register, login, getProfile,
      │                        generateToken (JWT), formatUserForResponse (strip
      │                        password). Knows nothing about req/res.
      │                        (login calls a missing comparePassword — P7 issue)
      ├─ repository/
      │  ├─ BaseRepository.js ─ abstract contract: 6 methods that throw
      │  │                      "not implemented". A stand-in for a JS interface.
      │  └─ UserRepository.js ─ the MongoDB implementation. create/findById/
      │                         findByUsername/findByEmail/findAll/count. The ONLY
      │                         file allowed to import the User model for writes.
      ├─ validation/
      │  └─ authSchema.js ─── onboard / registration / login schemas for
      │                       validate(). (P7)
      └─ Dependencies/
         └─ dependencies.js ── the composition root. News up repo → service →
                               controller and wires them. Imported by authRouter.
```

---

## 4. How a real request travels (as wired in Phase 7)

For the full station-by-station walk, see
[phase-7-wiring-auth-end-to-end/1-request-lifecycle.md](phase-7-wiring-auth-end-to-end/1-request-lifecycle.md).
The shape:

```
  HTTP request
      │
  ── APP-LEVEL middleware (server.js, every request) ──────────────────
  cookieParser → helmet → cors → express.json/urlencoded → inline logger
      │
  ── ROUTE MATCH ─────────────────────────────────────────────────────
  app.use("/api/auth", authRouter)  →  authRouter matches VERB + path
      │
  ── ROUTE-LEVEL middleware (authRouter.js, this route only) ──────────
  requestLogger → [authenticate → authorize(roles)]? → validate(schema)
      │
  ── THE LAYERS ──────────────────────────────────────────────────────
  Controller   read req, call ONE service method, shape res
      │ calls
  Service      business rules & decisions; never sees req/res
      │ calls
  Repository   the ONLY layer that touches Mongoose / SQL
      │ uses
  Model  ──►  MongoDB
      │
  ── BACK OUT ────────────────────────────────────────────────────────
  controller: res.cookie(...) + res.json(ResponseFormatter.success(...))
      │
  res emits "finish"  →  requestLogger logs status + duration
      │
  client
```

**The one rule:** a layer calls **down**, never up, never sideways into a
sibling. Controller must not run a query. Service must not read `req.body`.
Repository must not know what a JWT is.

**On an error:** a middleware either sends its own 4xx and stops, or the
controller's `catch { next(error) }` jumps straight to `errorHandler` (the 4-arg
middleware at the bottom of `server.js`), which sets the status from
`err.statusCode`, logs at the right level, hides internal messages on unexpected
5xx, and sends a `ResponseFormatter.error` envelope.

`Dependencies/dependencies.js` is off to the side: it builds one of each class
and wires them, so nothing else calls `new`. `authRouter` imports it to get the
finished controller.

---

## 5. Build timeline — what each phase added and why

| Phase | Added | Why then |
|---|---|---|
| **1 — Foundations** | Docker Compose infra; `config/index.js`; Winston logger; Mongo/Postgres/Rabbit connection singletons | Build the skeleton every feature stands on, before any feature |
| **2 — Data models** | `SecurityUtil` + four Mongoose schemas (`User`, `Client`, `ApiKey`, `ApiHits`) | Define the shape and rules of the data before code moves it around |
| **3 — HTTP contract** | `AppError`, `ResponseFormatter` | Fix one response shape and one error type *before* the first route, so every route conforms |
| **4 — Server bootstrap** | `server.js` rewritten (middleware, `/health`, connect-before-listen, graceful shutdown); `errorHandler`; `endpoint_metrics` SQL rollup table | Turn a pile of modules into a running process; give analytics a fast store |
| **5 — Running + Docker** | Fixed the startup-blocking bugs; `Dockerfile` + `Dockerfile.consumer`; `api-app` + gated `consumer` compose services | Make it actually boot, then make it boot the same way anywhere |
| **6 — Layered architecture** | `services/auth/` (repository → service → controller → DI container); `roles.js`; `cookie` config; `authenticate` / `authorize` | Set the architecture on the first real feature so every later feature copies it |
| **7 — Wiring auth end to end** | `authRouter` filled + mounted; `validate` middleware + `authSchema`; `requestLogger`; `authService` register/login/getProfile; `cookie-parser`; ~14 Phase 1–6 bugs fixed | Connect the built-but-dead auth slice to real HTTP, and pay down the bug debt so it actually serves a request |

---

## 6. What actually runs today vs what is just sitting there

**Runs** (as of `2fe568e`):

- `docker compose up` → Postgres + Mongo + RabbitMQ + pgAdmin + `api-app`.
- `server.js` boots, connects all three datastores, serves `GET /` and
  `GET /health`, 404s unmatched routes, shuts down cleanly on Ctrl-C.
- **`POST /api/auth/onboard-super-admin` works end to end** — creates the first
  admin, hashes the password, mints a JWT, returns it as an `httpOnly` cookie +
  a `ResponseFormatter` envelope. The `count({role})` guard blocks a second one.
- The full request pipeline is live: cookie-parser, helmet, cors-with-credentials,
  body parsing, per-route `requestLogger` / `authenticate` / `authorize` /
  `validate`, and the `errorHandler` at the bottom.

**Built but NOT reachable / half-wired:**

- `POST /api/auth/register`, `/login`, `/profile`, `/logout` — routes and
  middleware chains exist, but `authController` has only `onboardSuperAdmin`, so
  these throw `TypeError` → 500. `authService.register` / `login` / `getProfile`
  *are* written; `login` also calls a missing `comparePassword`.
- All four models — only `User` is reached (via `UserRepository`). `Client` /
  `ApiKey` / `ApiHits` have no caller.
- `endpoint_metrics` — the table exists, nothing writes it (no consumer).

**Does not exist:**

- The consumer process (`src/consumer.js`), so nothing drains `api_hits`.
- Feature slices beyond `auth`.
- Tests, linter config, CI.

**The single biggest open bug list** lives in [OPEN-ISSUES.md](OPEN-ISSUES.md).
