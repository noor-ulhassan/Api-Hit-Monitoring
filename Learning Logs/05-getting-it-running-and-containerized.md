# 05 - Getting It Running, and Into Containers

**Covers commits:** `a0b0c11` (Server started with fixed issues and bugs) and
`40eb9b7` (Dockerized the app). `04c104e` between them is a logs-only edit.
**Date range of work:** 1 Sep 2026.
**State of the app at end of this phase:** the server starts.
`initializeConnection()` connects to Mongo, Postgres, and RabbitMQ without
throwing, `app.listen` runs, and `GET /health` returns the envelope. The whole
local stack - app + Postgres + Mongo + RabbitMQ + pgAdmin - comes up from one
`docker compose up`, with the app image built from `server/Dockerfile`. A second
image and a `consumer` compose service exist but are switched off (a Docker
profile) because `src/consumer.js` has not been written. Still no feature routes:
`/api/auth`, `/api/hit`, `/api/analytics` are advertised by `GET /` and 404 in
practice.

---

## 1. Scope

Two jobs:

- **Clear the startup blockers.** The bugs from Phases 01 and 04 that stop the
  process booting: the broken `winston.combine`, the `MongoConnection` that
  exported a class and never set `this.connection`, the missing `import cors`,
  and the Postgres init-script filename. Plus cosmetic logging fixes in
  `postgres.js` / `rabbitmq.js`.
- **Containerise.** Fill both Dockerfiles, add a `.dockerignore`, and extend
  `docker-compose.yaml` with an `api-app` service (and a gated `consumer`
  service) so the app runs alongside its infrastructure from one command.

Not in scope: any feature route, the consumer's actual code, or the remaining
Phase 04 issues (`errorHandler` reading `req.statusCode`, `dotenv` called twice,
the dormant error middleware).

---

## 2. Context

Phase 04 wired a real bootstrap but left it unrunnable - `server.js` referenced
`cors` without importing it, and behind that sat four connection-module bugs
carried since Phase 01. "Server started with fixed issues and bugs" is the commit
that makes `npm run dev` actually produce a live server. Once it ran locally, the
next step was to make it run the same way anywhere - the dockerisation commit.

A large part of this phase was not code but **environment**: the gap between "the
code is correct" and "the code connects". That is written up as a dated
correction under Phase 04 section 5, Issue 6; section 3b here pulls out the
reusable lessons.

---

## 3. Concepts

### 3a. Docker image layering and build-cache order

A Dockerfile builds an image as a stack of layers, one per instruction. Docker
caches each layer and reuses it on the next build **only if that instruction and
every instruction before it are unchanged**. So instruction order is a
performance decision.

Both Dockerfiles do:

```
COPY package*.json ./
RUN npm install --production
COPY . .
```

not the simpler `COPY . .` then `RUN npm install`. Dependencies change rarely,
source changes constantly. By copying only the manifests first and installing
against those, the expensive `npm install` layer stays cached through every
source-only edit. Copy everything first and a one-character change to any file
busts the cache and reinstalls `node_modules` from scratch.

### 3b. "Correct code" vs "connects" - lessons from getting Postgres up

The 4a fixes were the code being wrong. Getting the app to actually reach
Postgres surfaced a separate class of problem, none of which a linter or a unit
test would catch. Recorded here because they recur on every project:

- **A bind mount whose source file does not exist is created as a directory.**
  `docker-compose.yaml` mounts `./scripts/init.postgres.sql` into the Postgres
  container. While the file on disk was still `init.postgress.sql`, Docker
  created `./scripts/init.postgres.sql` as an empty **directory**. Postgres's
  entrypoint then refuses to start because
  `/docker-entrypoint-initdb.d/init.postgres.sql` is a directory, not a `.sql`
  file - so the container never became healthy and the app got `ECONNREFUSED`.
  The fix was the rename *plus* deleting the stray directory.
- **`/docker-entrypoint-initdb.d` scripts only run on a first-time init.** The
  Postgres image runs `initdb` and the init scripts only when its data directory
  is empty. The `postgres_data` volume already held a cluster from earlier
  phases, so Postgres logged "Skipping initialization" and `endpoint_metrics` was
  never created. It had to be applied by hand
  (`docker exec -i ... psql ... < scripts/init.postgres.sql`).
- **`POSTGRES_PASSWORD` is also first-init only.** The pre-existing volume was
  created with a different password, so the compose value was ignored and the TCP
  login from Node failed with `28P01 password authentication failed`. (The
  in-container `psql` uses `trust` auth over the local socket, which hid the
  problem until Node connected over TCP.) Fixed with `ALTER USER postgres ...`,
  or `docker compose down -v` to wipe and re-init if the data is disposable.

The through-line: **stateful containers remember their first boot.** Changing an
env var in the compose file does not retroactively change a volume that already
exists.

### 3c. Healthchecks and ordered startup

`docker compose up` starts containers roughly together. `depends_on` alone
controls only *start order*, not *readiness* - the app would still race its
databases. The compose file pairs `depends_on` with `condition: service_healthy`:

```
depends_on:
  postgres:
    condition: service_healthy
  rabbitmq:
    condition: service_healthy
```

so `api-app` is held until Postgres's `pg_isready` and RabbitMQ's
`rabbitmq-diagnostics ping` healthchecks pass. Mongo has no healthcheck, so it is
**not** in that list - `api-app` can start before Mongo is ready and relies on
`restart: unless-stopped` to retry the boot until `mongodb.connect()` succeeds
(Issue 2).

### 3d. Compose profiles - shipping a service that is switched off

The `consumer` service is fully defined but carries `profiles: ["consumer"]`. A
service with a profile is skipped by a plain `docker compose up`; it starts (or
builds) only when that profile is named: `docker compose --profile consumer up`.
This is how you commit infrastructure for a component that does not exist yet -
`src/consumer.js` is not written - without breaking the default `up`. Both the
Dockerfile `CMD` and the compose block carry a comment saying so. It is the right
call: the wiring is version-controlled and reviewed now, and turned on the day
the code lands.

### 3e. `.dockerignore` - what does not go into the image

`docker build` sends the whole build context to the daemon and `COPY . .` copies
all of it. `.dockerignore` trims that: `node_modules` (reinstalled inside the
image, and a host copy would be the wrong platform), `.env*` / `*.log` / `logs`
(secrets and local runtime cruft), `.git`, and `Learning Logs` / `README.md`
(docs, not runtime). Smaller context = faster builds and a smaller, less leaky
image.

### 3f. Where configuration comes from, in a container

Locally the app reads `server/.env` via `dotenv`. In the container that file is
`.dockerignore`d and never present. Instead every setting is passed by the
compose `environment:` block (`NODE_ENV`, `PORT`, `MONGO_URI`, `PG_*`,
`RABBITMQ_URL`, ...), which `config/index.js` picks up through `process.env` just
the same. The one value not literal there is `JWT_SECRET: ${JWT_SECRET}`, which
Compose interpolates from its own environment or a `.env` beside the compose
file. Net effect: **container config lives entirely in `docker-compose.yaml`;
`server/.env` is a local-dev-only artifact.**

### 3g. The two-image split, realised

Phase 01 committed to two Dockerfiles "because they are two processes". This
phase fills them, and they are near-identical - same base, same `WORKDIR`, same
install steps - differing only in the final `CMD` (`src/server.js` vs
`src/consumer.js`). The duplication is accepted for now; a shared base image is
the obvious later refactor. What the split buys: the API and the (future) worker
are independently buildable and scalable, sharing only the repo.

---

## 4. Walkthrough

### 4a. The bug fixes - `a0b0c11`

**What we did.** Six small edits that together let the process boot.

| File | Change | Fixes |
|---|---|---|
| `shared/config/logger.js` | `winston.combine(...)` -> `winston.format.combine(...)` in the non-prod console transport | Phase 01 Issue 4 - `winston.combine` is not a function; adding the console transport threw on every non-prod run |
| `shared/config/mongodb.js` | `this.connection = mongoose.connection` after `connect()`; `"Disconnected"` -> `"disconnected"`; `export default new MongoConnection()` | Phase 01 Issues 1-3 - the module was unusable: attached listeners to `null`, listened for an event Mongoose never emits, and exported the class instead of a singleton |
| `src/server.js` | add `import cors from "cors";` | Phase 04 Issue 1 - `app.use(cors())` threw `ReferenceError` at module load; the server could not start at all |
| `scripts/init.postgress.sql` -> `scripts/init.postgres.sql` | `git mv` | Phase 01 Issue 10 / Phase 04 Issue 6 - the compose bind mount pointed at the single-"s" name; the script never ran |
| `shared/config/postgres.js` | `logger.info("Postgres Client connected", result.rows[0].now)` -> template literal | the extra positional argument was not reliably landing in the rendered log line; a template literal makes the value part of the message string |
| `shared/config/rabbitmq.js` | same template-literal fix on three `logger.info` calls | same reason |

Also in this commit: `.gitignore` gains `logs`, and `server/Dockerfile` gets a
one-line stub `FROM node-alpine` (not a valid image tag - superseded in
`40eb9b7`).

**What it does.** `npm run dev` now runs `initializeConnection()` to completion
and reaches `app.listen`. Before this commit it crashed at import (`cors`), or at
the first non-prod log call (`winston.combine`), or on the first Mongo call.

**Why these and not the rest.** The commit is scoped to "make it start". The
`errorHandler` `req.statusCode` bug (Phase 04 Issue 2), the double
`dotenv.config()` (Issue 5), the `jwt.sercet` typo and `node_env: "Development "`
default (Phase 01 Issues 5-6), and `rabbitmq.getStatus()` reading `this.connect`
(Phase 01 Issue 7) are all still in the tree - none block boot, so they were left
(Issues 6-7 below).

### 4b. Making Postgres actually accept the connection

Not a code change - an environment fix, summarised from the dated correction in
Phase 04 section 5. The rename in 4a was necessary but not sufficient: a stray
mount-created directory had to be removed, the schema applied by hand because the
existing volume skipped init, and the `postgres` password reset with
`ALTER USER` to match `server/.env`. `server/.env` was also tidied - trailing
spaces stripped from `PG_USER` / `PG_PASSWORD`, and `RABBITMQ_URL` credentials
changed to `admin:12345` to match the broker's compose env. After that,
`postgres.testConnection()` passed standalone and `endpoint_metrics` (plus its
four indexes and the `updated_at` trigger) exists in the running database.

### 4c. `Dockerfile` and `Dockerfile.consumer` - `40eb9b7`

**What we did.** `a0b0c11` had left `server/Dockerfile` as the stub
`FROM node-alpine` - not a valid image reference, so it would not build. This
commit writes both files properly.

`Dockerfile`:

```
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p logs
EXPOSE 5000
CMD ["node", "src/server.js"]
```

`Dockerfile.consumer` is identical except `CMD ["node", "src/consumer.js"]` and a
comment that the file does not exist yet.

**What it does.** `docker build` produces a Node-18-on-Alpine image with
production dependencies only, the source copied in, a `logs/` directory
pre-created (so Winston's file transports do not fail if the image runs without
the compose volume), port 5000 documented, and the API process as the default
command.

**Why each line:**

- **`node:18-alpine`** - Alpine for a small image; a pinned major for
  reproducibility. (It is *18*, while local dev runs Node 24, and Node 18 is
  end-of-life - Issue 1.)
- **`COPY package*.json` -> `RUN npm install` -> `COPY . .`** - the
  cache-friendly order from 3a.
- **`npm install --production`** - skip devDependencies (`nodemon`); the image
  does not need the file-watcher. (`--production` is the deprecated spelling of
  `--omit=dev`; still works, warns.)
- **`RUN mkdir -p logs`** - belt-and-braces; the compose service also bind-mounts
  `./logs`, which shadows this, but a bare `docker run` would not.
- **`EXPOSE 5000`** - documentation only (it publishes nothing); it matches the
  `PORT: 5000` the compose file injects.
- **`CMD ["node", "src/server.js"]`** - exec form, so the Node process is PID 1
  and receives `SIGTERM` directly - which is what the Phase 04 graceful-shutdown
  handler needs.

### 4d. `docker-compose.yaml` - the `api-app` and `consumer` services

**What we did.** Added two services to the existing four (`postgres` / `mongo` /
`rabbitmq` / `pgadmin`).

**`api-app`:**

- `build: { context: ., dockerfile: Dockerfile }` - built from the repo, not
  pulled.
- `environment:` - the full config set, pointing at the *service names* on the
  compose network: `MONGO_URI: mongodb://mongo:27017/...`, `PG_HOST: postgres`,
  `RABBITMQ_URL: amqp://admin:12345@rabbitmq:5672/api_monitoring`.
  `NODE_ENV: production` (so the logger drops to `info` and writes files).
  `PORT: 5000`.
- `ports: ["5000:5000"]`; `volumes: ["./logs:/app/logs"]` (logs land on the
  host).
- `depends_on:` postgres + rabbitmq `condition: service_healthy` (see 3c).
- `healthcheck:` `wget -q -O- http://localhost:5000/health` every 30s, with a
  20s `start_period` grace while the app connects. (`wget` is in Alpine's
  BusyBox; `curl` is not.)
- `restart: unless-stopped`.

**`consumer`:** the same shape, building `Dockerfile.consumer`, but gated behind
`profiles: ["consumer"]` (see 3d) - a plain `up` skips it.

**What it does.** `docker compose up -d --build` brings up the databases, waits
for Postgres and RabbitMQ to report healthy, then starts `api-app`, which
connects and serves on host port 5000. `curl localhost:5000/health` returns the
`ResponseFormatter` envelope. The consumer stays down.

**Why:** one command reproduces the whole runtime on any machine, with the app
talking to containerised infrastructure over a private bridge network by service
name - no host IPs, no "works on my machine" for the datastores.

### 4e. `.dockerignore` and `.gitignore`

- **`server/.dockerignore`** (new) - excludes `node_modules`, `.env*`, `logs`,
  `*.log`, `.git`, `Learning Logs`, `README.md`, editor dirs. See 3e.
- **`.gitignore`** - added `logs`, so runtime log files (`logs/error.log`,
  `logs/combined.log`) are never committed. `server/logs/log.js` is already
  tracked from Phase 01 and is unaffected.

---

## 5. Issues, shortcuts, and TODO

Blunt list. New issues from this phase, plus what it left.

1. **Container runtime is Node 18, dev is Node 24.** `Dockerfile` pins
   `node:18-alpine`. Node 18 reached end-of-life in April 2025 - no more security
   patches. Bump both Dockerfiles to an active LTS and match local dev.
2. **`api-app` does not wait for Mongo.** `depends_on` lists only postgres and
   rabbitmq (the two with healthchecks). On a cold `up`, `api-app` can boot
   before Mongo accepts connections; `mongodb.connect()` throws,
   `startServer()` exits 1, and `restart: unless-stopped` retries until it works.
   It converges but crash-loops first. Give `mongo` a healthcheck (Phase 01
   Issue 18) and add it to `depends_on`.
3. **`JWT_SECRET` via `${JWT_SECRET}` is fragile.** Compose resolves it from its
   own environment or a `.env` beside the compose file. `server/.env` uses
   `KEY = value` with surrounding spaces, which Compose's interpolation does not
   parse the way `dotenv` does. Verify it is actually populated in the container
   (`docker compose config`), or it silently becomes empty and every later token
   operation fails.
4. **DB credentials hard-coded in `docker-compose.yaml`.** `PG_PASSWORD:
   password`, `admin:12345` for RabbitMQ, Mongo with no auth. Fine for local, not
   for anything shared. Move to an `env_file:` or compose secrets before this
   leaves a laptop.
5. **Neither image sets a non-root `USER`.** Both run as root. `node:alpine`
   ships a `node` user; add `USER node` after `chown`ing `/app` and `logs`.
6. **Phase 04 bugs still open.** `errorHandler.js` reads `req.statusCode` not
   `err.statusCode` (Phase 04 Issue 2); `dotenv.config()` runs in both
   `server.js` and `config/index.js` (Issue 5); the error middleware is still
   unreachable (Issue 3); `AppError` still has no consumer (Issue 4).
7. **Phase 01 bugs still open.** `config/index.js` has `jwt.sercet` (so
   `config.jwt.secret` is `undefined`) and
   `node_env: process.env.NODE_ENV || "Development "` (capital D, trailing space -
   any `=== "development"` check fails). `rabbitmq.getStatus()` reads
   `this.connect` (the method) instead of `this.connection`, so it never reports
   `DISCONNECTED`. `parseInt(process.env.PORT || 8080)` is missing its radix.
8. **`init.postgres.sql` still not automatic on an existing volume.** The rename
   fixed the mount, but any environment with a pre-existing `postgres_data`
   volume still needs the schema applied by hand or the volume wiped
   (`down -v`). Only a first-time volume auto-runs it. Belongs in the repo
   README.
9. **The `consumer` service builds nothing runnable.** By design (3d) - just
   note that `docker compose --profile consumer up` starts a container that exits
   immediately (`Cannot find module '/app/src/consumer.js'`) and then
   `restart`-loops. Keep the profile off until the file exists.
10. **`/health` is not a real readiness probe.** The `api-app` healthcheck hits
    `/health`, but that route returns `uptime`, not "can I reach
    Mongo/Postgres/Rabbit". A container can report healthy while its datastores
    are gone. A meaningful probe would ping the connections.

---

## 6. Commit history for this phase

| Commit | What landed and why |
|---|---|
| `04c104e` Logs Improved | Edits across the `01`-`04` logs (structure and wording). No code. |
| `a0b0c11` Server started with fixed issues and bugs | The startup-blocking fixes: `winston.format.combine`, the `MongoConnection` singleton + `this.connection` + event-name fixes, `import cors`, the `init.postgres.sql` rename, and template-literal logging in `postgres.js` / `rabbitmq.js`. Plus `.gitignore logs` and a stub `Dockerfile`. The server now boots and connects. |
| `40eb9b7` Dockerized the app | Real `Dockerfile` (`node:18-alpine`, cache-ordered install, `CMD node src/server.js`) and `Dockerfile.consumer` (same, `src/consumer.js`, unbuilt). `server/.dockerignore`. `docker-compose.yaml` gains `api-app` (built, healthchecked, waits on postgres + rabbitmq) and `consumer` (behind a `consumer` profile). One `docker compose up` now runs the whole stack. |

Also this phase, outside a commit: a dated correction was added to Phase 04
section 5 (Issue 6) covering the Postgres volume / password / init-script fixes.

---

## 7. Glossary additions

- **Image layer / build cache.** Each Dockerfile instruction is a cached layer;
  a layer and everything downstream rebuilds when that instruction's inputs
  change. Order cheap-and-stable steps before expensive-and-volatile ones.
- **`.dockerignore`.** Excludes paths from the build context so `COPY` cannot
  pick them up - keeps images small and secrets out.
- **Healthcheck (compose).** A command a container runs on a schedule to report
  ready / not-ready; `depends_on: { condition: service_healthy }` makes one
  service wait for another's healthcheck to pass.
- **Compose profile.** A tag on a service that keeps it out of the default `up`;
  it starts only when its profile is explicitly requested. Used to ship
  not-yet-active services.
- **First-init-only.** Behaviour of stateful images (Postgres, MySQL, ...) that
  runs setup - `initdb`, `POSTGRES_PASSWORD`, `/docker-entrypoint-initdb.d`
  scripts - only when the data volume is empty. Later changes to those env vars
  or scripts do nothing until the volume is recreated.
- **Bind mount.** Maps a host path into a container. If the host path does not
  exist, the daemon creates it - as a directory - a common way to end up with a
  "file" that is silently a folder.
- **Exec-form `CMD`.** `CMD ["node", "x.js"]` (not `CMD node x.js`) - runs the
  binary as PID 1 with no shell, so signals like `SIGTERM` reach it directly.

---

## 8. Not yet built at the end of this phase

Facts, no roadmap:

- No feature routes. `/api/auth`, `/api/hit`, `/api/analytics` are strings in the
  `GET /` response only.
- No `src/consumer.js`; the consumer image and compose service exist but run
  nothing.
- Nothing writes `endpoint_metrics`; nothing publishes to or drains `api_hits`.
- `express-rate-limit` still unused; no auth or JWT-verify middleware.
- The Phase 04 error middleware is still unreachable, and several Phase 01 / 04
  bugs remain (section 5, Issues 6-8).
- No CI, no tests, no linter config.
