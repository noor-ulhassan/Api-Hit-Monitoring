# 3 · The config object and the logger

**Mental model:** two shared singletons every other file leans on — one owns
*settings*, one owns *output*.

---

## `src/shared/config/index.js` — the one config boundary

One module exports one object. Sections: `node_env`, `port`, `mongo`,
`postgres`, `rabbitmq`, `jwt`, `ratelimit`. Every value is
`process.env.X || default`; every number is wrapped in `parseInt(..., 10)`.

**Why it is built this way:**

- **One import boundary.** Everything does
  `import config from ".../config/index.js"`. A grep for `process.env` should
  hit *only* this file — so "what settings does this app need?" is a one-file
  question.
- **Defaults are the local-dev values**, chosen to line up with the compose
  file, so a fresh clone runs with an almost-empty `.env`.
- **`parseInt(x, 10)` at the boundary.** Env vars are always strings. Passing
  `"5432"` where `pg` wants `5432` is a quiet type bug later. Parse once, here.
  Radix `10` blocks any legacy octal reading of a leading zero.
- **Booleans need coercion.** `process.env.X === "true"` turns the string into a
  real boolean; the string `"false"` is otherwise truthy.
- **Retry knobs (`retryAttempts`, `retryDelay`) are declared before the code
  that uses them** — the config names a reconnect-with-backoff behaviour the
  RabbitMQ module does not implement yet; the knobs are a placeholder.

### `.env` today

Only `NODE_ENV`, `PORT`, `MONGO_DB_NAME`, `MONGO_URI`, `JWT_SECRET` are set.
Postgres and RabbitMQ run entirely on code defaults.

### Secrets

- `.env` is git-ignored — real secrets stay off GitHub. Correct.
- The **in-code fallback secrets** (`password`, `noorulhassan1`) are fine for
  local dev only. Hardening rule for later: in production, a missing
  `JWT_SECRET` or DB password should make the process **refuse to start**, not
  fall back to a known default — replace `|| "default"` with a startup
  assertion for the critical ones.

### Known bugs *(see [../OPEN-ISSUES.md](../OPEN-ISSUES.md))*

- `jwt.sercet` typo — `config.jwt.secret` is `undefined`. Still open, and by
  Phase 6 it is load-bearing in three files (they all read the typo).
- `node_env` default is `"Development "` — capital D, trailing space. Any
  `=== "development"` check fails.

---

## `src/shared/config/logger.js` — structured logging

A Winston logger: level `info` in production / `debug` otherwise; JSON format
with timestamp, error stacks, printf interpolation; `defaultMeta`
`{ service: "api-monitoring" }`; file transports for `logs/error.log`
(error-only) and `logs/combined.log`; a colourised console transport when not in
production.

**Why not `console.log`:**

- **Levels with a threshold.** `debug` calls stay in the code but vanish in
  production because the threshold is `info`. No commenting-out, no redeploy to
  change verbosity.
- **JSON in files.** Every line is an object with `timestamp`, `level`,
  `message`, `service`, and call-site metadata — the format a log aggregator
  (Loki, ELK, CloudWatch, Datadog) ingests. Plain text is not searchable across
  processes.
- **`format.errors({ stack: true })`** keeps the stack trace when an `Error` is
  logged, instead of it collapsing to `{}`.
- **`defaultMeta.service`** tags every line, so if a second process (a consumer)
  ever logs to the same place, its lines can be told apart — it would set its
  own `service` value.
- **Separate transports** = separate destinations with their own level.
  `error.log` is the "what broke" file; `combined.log` is the full record.

In a real deployment you would log only to stdout and let the platform collect
it; the file transports are a tutorial-phase convenience and do no harm.

### Known bug

`winston.combine(...)` in the non-prod console transport is not a function — it
must be `winston.format.combine`. As written it throws in development.
**Fixed in Phase 5.**
