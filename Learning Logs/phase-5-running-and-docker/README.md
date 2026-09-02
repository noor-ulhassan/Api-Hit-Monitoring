# Phase 5 — Getting it running, and into containers

**One line:** clear the bugs that stop the process booting, then make it boot the
same way anywhere.

**Commits:** `a0b0c11` (bug fixes) + `40eb9b7` (Docker)  **Date:** 1 Sep 2026

**State after this phase:** the server starts. It connects to Mongo + Postgres +
RabbitMQ without throwing, `GET /health` returns the envelope, Ctrl-C shuts down
cleanly. `docker compose up` brings the whole stack — app + 4 infra containers —
online from one command. A `consumer` image and service exist but are switched
off (Compose profile) because `src/consumer.js` isn't written.

---

## Files this phase touched

```
server/
├─ src/shared/config/{logger,mongodb,postgres,rabbitmq}.js   bug fixes
├─ src/server.js                       + import cors
├─ scripts/init.postgress.sql  → init.postgres.sql   (git mv)
├─ .gitignore                          + logs
├─ Dockerfile                          stub → real (node:18-alpine, cache-ordered)
├─ Dockerfile.consumer                 NEW — same, CMD src/consumer.js (unbuilt)
├─ .dockerignore                       NEW
└─ docker-compose.yaml                 + api-app service, + gated consumer service
```

## Read in this order

1. **[1-startup-bug-fixes.md](1-startup-bug-fixes.md)** — the six edits that let
   the process boot.
2. **[2-getting-postgres-connected.md](2-getting-postgres-connected.md)** — the
   environment mess the SQL rename uncovered ("correct code" vs "connects").
3. **[3-dockerfiles.md](3-dockerfiles.md)** — both images, line by line.
4. **[4-compose-services.md](4-compose-services.md)** — `api-app` and the
   profile-gated `consumer`.

## The gist

- **"Fixed issues and bugs" = make it start.** `winston.format.combine`; the
  `MongoConnection` singleton + `this.connection` + `"disconnected"`;
  `import cors`; the `init.postgres.sql` rename.
- **Correct code ≠ connects.** Stateful containers remember their first boot: an
  init script and `POSTGRES_PASSWORD` only apply to a fresh volume; a bind mount
  whose source file is missing is created as a *directory*.
- **Docker build-cache order:** `COPY package.json` → `npm install` → `COPY . .`
  keeps the install layer cached through every source edit.
- **Compose `depends_on: { condition: service_healthy }`** makes `api-app` wait
  for Postgres + RabbitMQ healthchecks. Mongo has none, so `api-app` can race it
  and relies on `restart` to retry.
- **Compose profiles** ship a switched-off service: `consumer` is fully defined
  but skipped by a plain `up` until `src/consumer.js` exists.

## Issues opened here

Container Node is 18 (EOL) vs dev Node 24; `api-app` doesn't wait for Mongo;
`${JWT_SECRET}` interpolation is fragile against `.env` spacing; DB creds
hard-coded in compose; no non-root `USER`; `/health` isn't a real readiness
probe. All in [../OPEN-ISSUES.md](../OPEN-ISSUES.md).
