# 4 · `docker-compose.yaml` — `api-app` and `consumer`

**Mental model:** two new services join the four infra containers. `api-app`
waits for its dependencies to be *healthy*, not just *started*. `consumer` is
defined but switched off.

---

**What we did.** Added two services to the existing four (`postgres` / `mongo` /
`rabbitmq` / `pgadmin`).

## `api-app`

- **`build: { context: ., dockerfile: Dockerfile }`** — built from the repo, not
  pulled.
- **`environment:`** — the full config set, pointing at *service names* on the
  compose network: `MONGO_URI: mongodb://mongo:27017/...`, `PG_HOST: postgres`,
  `RABBITMQ_URL: amqp://admin:12345@rabbitmq:5672/api_monitoring`.
  `NODE_ENV: production` (logger drops to `info`, writes files). `PORT: 5000`.
- **`ports: ["5000:5000"]`**, **`volumes: ["./logs:/app/logs"]`** (logs land on
  the host).
- **`depends_on:` postgres + rabbitmq `condition: service_healthy`** — held until
  Postgres's `pg_isready` and RabbitMQ's `rabbitmq-diagnostics ping` pass. Mongo
  has no healthcheck, so it is **not** listed — `api-app` can start before Mongo
  is ready and relies on `restart: unless-stopped` to retry the boot (Issue).
- **`healthcheck:` `wget -q -O- http://localhost:5000/health`** every 30s, 20s
  `start_period` grace while the app connects. (`wget` is in Alpine's BusyBox;
  `curl` is not.)

## `consumer`

Same shape, building `Dockerfile.consumer`, but **`profiles: ["consumer"]`** — a
plain `docker compose up` skips it. It starts only with
`docker compose --profile consumer up`. This is how you commit infrastructure
for a component that doesn't exist yet (`src/consumer.js`) without breaking the
default `up`. Both the Dockerfile `CMD` and the compose block carry a comment
saying so. The right call: the wiring is version-controlled and reviewed now,
turned on the day the code lands.

## What it does

`docker compose up -d --build` brings up the databases, waits for Postgres and
RabbitMQ to report healthy, then starts `api-app`, which connects and serves on
host port 5000. `curl localhost:5000/health` returns the `ResponseFormatter`
envelope. The consumer stays down.

## Where config comes from, in a container

Locally the app reads `server/.env` via `dotenv`. In the container that file is
`.dockerignore`d and never present — every setting comes from the compose
`environment:` block, which `config/index.js` picks up through `process.env` the
same way. The one non-literal value is `JWT_SECRET: ${JWT_SECRET}`, which Compose
interpolates from its own environment or a `.env` beside the compose file
(fragile against `server/.env`'s `KEY = value` spacing — Issue). Net effect:
**container config lives entirely in `docker-compose.yaml`; `server/.env` is
local-dev only.**
