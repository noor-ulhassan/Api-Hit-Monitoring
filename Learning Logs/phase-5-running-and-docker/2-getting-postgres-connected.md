# 2 · "Correct code" vs "connects" — getting Postgres up

**Mental model:** the code being right is half the battle. The other half is that
**stateful containers remember their first boot** — and nothing in a linter or a
test tells you that.

---

The `init.postgres.sql` rename in [1-startup-bug-fixes.md](1-startup-bug-fixes.md)
was necessary but not sufficient. Getting the app to actually reach Postgres
surfaced a separate class of problem. Recorded because it recurs on every
project:

- **A bind mount whose source file doesn't exist is created as a directory.**
  `docker-compose.yaml` mounts `./scripts/init.postgres.sql` into the Postgres
  container. While the file was still `init.postgress.sql`, Docker created
  `./scripts/init.postgres.sql` as an empty **directory**. Postgres's entrypoint
  then refuses to start (`/docker-entrypoint-initdb.d/init.postgres.sql` is a
  directory, not a `.sql` file) — so the container never became healthy and the
  app got `ECONNREFUSED`. Fix: the rename **plus** deleting the stray directory.

- **`/docker-entrypoint-initdb.d` scripts only run on a first-time init.** The
  Postgres image runs `initdb` and the init scripts only when its data directory
  is empty. The `postgres_data` volume already held a cluster from earlier
  phases, so Postgres logged "Skipping initialization" and `endpoint_metrics`
  was never created. Applied by hand:
  `docker exec -i api-monitoring-postgres psql -U postgres -d api_monitoring < scripts/init.postgres.sql`.

- **`POSTGRES_PASSWORD` is also first-init only.** The pre-existing volume was
  created with a different password, so the compose value was ignored and the
  TCP login from Node failed with `28P01 password authentication failed`. (The
  in-container `psql` uses `trust` over the local socket, which hid it until Node
  connected over TCP.) Fixed with `ALTER USER postgres WITH PASSWORD 'password'`,
  or `docker compose down -v` to wipe and re-init if the data is disposable.

**The through-line:** changing an env var in the compose file does **not**
retroactively change a volume that already exists.

`server/.env` was tidied in the same pass — trailing spaces stripped from
`PG_USER` / `PG_PASSWORD`, and `RABBITMQ_URL` credentials changed to
`admin:12345` to match the broker's compose env. After that
`postgres.testConnection()` passed standalone, and `endpoint_metrics` + its four
indexes + the `updated_at` trigger exist in the running database.
