# 2 · Repo layout, dependencies, and infra

**Mental model:** one repo, two processes that share a `shared/` folder; four
containers they talk to.

---

## Layout (as of this phase)

```
Api-Hit-Monitoring/
├─ .gitignore                 ignores node_modules and .env
├─ Learning Logs/             these docs
└─ server/
   ├─ .env                    local secrets/config — NOT committed
   ├─ package.json            deps; "type": "module" (ESM)
   ├─ docker-compose.yaml     local infra
   ├─ Dockerfile              producer image — empty so far
   ├─ Dockerfile.consumer     consumer image — empty so far
   ├─ scripts/init.postgress.sql   schema bootstrap — empty (and misspelled)
   ├─ logs/log.js             placeholder; Winston writes error.log/combined.log here
   └─ src/
      ├─ server.js            API entry point — still a stub
      └─ shared/
         ├─ config/  index.js · logger.js · mongodb.js · postgres.js · rabbitmq.js
         └─ models/  User.js · Client.js · ApiKey.js · ApiHits.js   (empty)
```

### Why this structure

- **`src/shared/` exists because two processes share one codebase.** Producer
  and consumer both need config, the logger, the DB clients, and the models.
  Those belong to neither, so they do not live under a `producer/` or
  `consumer/` folder. Feature modules are meant to sit *next to* `shared/`
  (which is what Phase 6's `services/` does).
- **`config/` is the only place allowed to read `process.env`.** One file to
  audit for missing settings, one file to change on a rename. Twelve-Factor:
  config comes from the environment, through one boundary.
- **Two Dockerfiles because they are two processes.** Same code, different entry
  point, different scaling profile (API scales with request traffic, consumer
  with queue depth). Separate images keep those independent.
- **`models/` is stubbed now** so imports and folder intent exist before the
  schemas are written.

---

## Dependencies

Runtime: **Node.js 24**, **ES Modules** (`"type": "module"`).

| Package | Role | Note |
|---|---|---|
| `express` `^5` | HTTP framework | Express 5: async errors reach error middleware with no manual `try/catch` forwarding |
| `mongoose` | MongoDB ODM | schema + validation layer over the raw driver |
| `pg` | PostgreSQL driver | used directly with a `Pool`, no ORM — small relational surface |
| `amqplib` | RabbitMQ (AMQP 0-9-1) client | low-level on purpose: we manage connections, channels, acks |
| `winston` | logging | structured JSON, level thresholds, multiple transports |
| `dotenv` | `.env` → `process.env` | dev convenience; production sets real env vars |
| `bcryptjs` | hashing | pure JS, no native build step |
| `jsonwebtoken` | JWT sign/verify | dashboard session tokens |
| `cors` | cross-origin headers | for a browser frontend |
| `helmet` | security headers | HSTS, no-sniff, frameguard |
| `express-rate-limit` | throttling | protects the API, enforces per-key limits |
| `uuid` | id generation | public ids, correlation ids |
| `nodemon` *(dev)* | auto-restart | `npm run dev` |

At this phase, `helmet` / `cors` / `express-rate-limit` / `bcryptjs` /
`jsonwebtoken` / `uuid` are installed but **unused** — a stated plan, not
current behaviour.

---

## Infrastructure — `docker-compose.yaml`

| Service | Image | Host port | Purpose |
|---|---|---|---|
| `postgres` | `postgres:15-alpine` | 5432 | relational store; healthcheck `pg_isready`; volume `postgres_data`; runs `scripts/init.postgres.sql` on first boot |
| `mongo` | `mongo:6.0` | **27018** → 27017 | event store; volume `mongo_data`; **no healthcheck** |
| `rabbitmq` | `rabbitmq:3-management-alpine` | 5672 (AMQP), 15672 (UI) | broker; user `admin` / pass `12345` / vhost `api_monitoring`; healthcheck `rabbitmq-diagnostics ping` |
| `pgadmin` | `dpage/pgadmin4:7` | 5050 → 80 | browser UI for Postgres; `depends_on: postgres` |

All on one bridge network (resolve each other by service name); all
`restart: unless-stopped`.

### Why these choices

- **Named volumes** persist data across `docker compose down`. Without them,
  every recreation wipes the databases — a classic early mistake.
- **Healthchecks** report *readiness*, not "process started". `depends_on` alone
  only orders startup; it does not wait for a database to accept connections
  unless paired with `condition: service_healthy`.
- **`27018:27017` port remap** avoids colliding with a MongoDB already on the
  host. The container still speaks 27017 internally.
- **Alpine images**, pinned versions (`postgres:15`, not `latest`) — small pulls,
  reproducible environment.
