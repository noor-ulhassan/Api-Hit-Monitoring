# Phase 1 — Foundations, infrastructure, and configuration

**One line:** the skeleton every later feature stands on — local infra, the
config object, the logger, and the three DB/queue connection singletons.

**Commits:** `5aa9a12` → `1d2f210`  **Dates:** 14–24 Jul 2026

**State after this phase:** infrastructure and connection code exist and are
understood; nothing is wired together. `server.js` still returns `"Hi"`. The
model files are empty placeholders. No routes, no business logic.

---

## Files this phase touched

```
server/
├─ docker-compose.yaml       postgres + mongo + rabbitmq + pgadmin, one network
├─ Dockerfile / .consumer    empty placeholders (two images = two processes)
├─ package.json              deps, "type": "module" (ESM), Node 24
├─ scripts/init.postgress.sql   empty (and misspelled — see issues)
├─ logs/log.js               placeholder; Winston writes error.log/combined.log here
└─ src/
   ├─ server.js              still a stub returning "Hi"
   └─ shared/
      ├─ config/
      │  ├─ index.js         THE config object — the only reader of process.env
      │  ├─ logger.js         Winston: JSON to files, colour to console in dev
      │  ├─ mongodb.js        MongoConnection singleton
      │  ├─ postgres.js       pg Pool singleton + boot smoke test + timed query()
      │  └─ rabbitmq.js       RabbitMqConnection singleton + api_hits + DLQ wiring
      └─ models/              User / Client / ApiKey / ApiHits — all empty
```

## Read in this order

1. **[1-product-and-architecture.md](1-product-and-architecture.md)** — what the
   product is, and why a queue and two databases (the shape of everything).
2. **[2-repo-layout-and-tooling.md](2-repo-layout-and-tooling.md)** — why
   `shared/`, why two Dockerfiles, the dependency list, the compose services.
3. **[3-config-and-logging.md](3-config-and-logging.md)** — the one config
   boundary; structured logging and why not `console.log`.
4. **[4-db-and-queue-connections.md](4-db-and-queue-connections.md)** — why all
   three connections are singletons; the pool, the Mongoose wrapper, the AMQP
   connection/channel/DLQ story.

## The gist

- **Producer/consumer split.** One process takes HTTP and publishes hit
  messages; a second (not built) drains the queue and stores them. Same repo,
  two entry points, two images.
- **A queue in the middle** buys a fast hot path, backpressure, independent
  scaling, and no silent data loss — at the cost of eventual consistency.
- **One config boundary.** `config/index.js` is the only file that reads
  `process.env`. Everything else imports the typed object.
- **Everything long-lived is a singleton** — the logger and all three
  connections. `export default new TheClass()`; Node's module cache does the
  rest.
- **The connection modules are lifecycle owners** — each has `connect`, a health
  check, and `close` for graceful shutdown.
- **RabbitMQ's safety net is declared at connect time** — the `api_hits` queue
  and its `api_hits.dlq` dead-letter route exist before the first message.

## Issues opened here

Bugs that made it in (all tracked in [../OPEN-ISSUES.md](../OPEN-ISSUES.md)):
`mongodb.js` unusable (3 bugs — **fixed Phase 5**), `logger.js` `winston.combine`
(**fixed Phase 5**), `config/index.js` `jwt.sercet` typo and `"Development "`
default (**open**), `rabbitmq.js` `getStatus` reads `this.connect` (**open**),
the `init.postgress.sql` filename (**fixed Phase 5**), and several infra
mismatches (Mongo port, RabbitMQ URL default, `dotenv` called twice).
