# 1 · The product and the architecture

**Mental model:** a firehose of "someone called an API" events, buffered through
a queue, split across two databases because accounts and event-streams want
opposite things.

---

## What we are building

An **API hit monitoring tool** — a small self-hosted version of RapidAPI
analytics / Moesif / an API-gateway dashboard. The intended flow:

1. A **client** (an org or developer) registers.
2. They mint one or more **API keys**.
3. Their backend calls our **ingest endpoint** on every request they want
   tracked, passing the key.
4. We record each call as an **API hit**: key, route, method, status, latency,
   timestamp, maybe IP + user-agent.
5. We expose **analytics**: totals, per-key, per-route, error rates, latency,
   usage over time, plus rate-limit enforcement.

## Why the architecture is heavier than a CRUD app

Two properties of the problem force it:

- **Write volume that never stops.** Hit events arrive continuously. The ingest
  path must accept a hit and return in milliseconds **without waiting on a
  database**.
- **Two data shapes pulling opposite ways.** Accounts / keys / permissions are
  relational and correctness-critical. Hit events are a huge append-only stream
  read mostly as aggregates. One engine cannot be great at both.

## The runtime shape

```
   HTTP clients ─▶ PRODUCER (Express)  ─ writes accounts/keys ─▶ (a database)
                        │
                        │ publishes one small JSON message per hit
                        ▼
                   RabbitMQ: api_hits  ──fail──▶ api_hits.dlq
                        │
                        │ consumer pulls
                        ▼
                   CONSUMER (worker)  ─ writes raw hits + rollups ─▶ (databases)
```

See [THE-MAP.md](../THE-MAP.md) §2 for the current, fully-labelled version.

## Why a message queue sits in the middle

The naive design does an `INSERT` on every ingest request. That ties your API's
latency and uptime to the database's: a slow or briefly-down database fails every
client call, and a traffic spike becomes a write spike with no buffer.

Putting RabbitMQ between "accept the hit" and "store the hit" buys four things:

- **A fast hot path.** The producer publishes a small message and returns.
  Publishing is cheap and in-memory on the broker.
- **Backpressure instead of failure.** If the consumer or its database slows,
  messages pile up in the queue (a bounded buffer) instead of errors propagating
  to clients.
- **Independent scaling and deploys.** Restart the consumer, or run five, without
  touching the API. They share only the message format.
- **No silent data loss.** A message that cannot be processed is **dead-lettered**
  for inspection and replay, not dropped.

The price is **eventual consistency**: a hit is queryable a short time after it
arrives, not instantly. Fine for analytics; not fine for account balances.

## Why two databases (polyglot persistence)

| Need | Engine | Why |
|---|---|---|
| accounts, clients, API keys, permissions | *(planned: PostgreSQL)* | low write rate, correctness critical, relational, transactions, unique constraints |
| API hit events + aggregates | MongoDB | very high write throughput, drifting schema, self-contained documents, time-bucketed aggregates, TTL expiry of raw events |

Right engine per shape beats bending one engine to do both. The cost is
operational: two datastores to run, back up, monitor.

> **Correction (Phase 4).** This split changed. Phase 2 moved `User` / `Client` /
> `ApiKey` into **MongoDB**. Phase 4 gave **PostgreSQL** a different job:
> pre-aggregated analytics rollups (`endpoint_metrics`). Current state: Mongo
> holds accounts *and* raw hits; Postgres holds the rollup table. Treat the table
> above as the original plan, not today's architecture — [THE-MAP.md](../THE-MAP.md)
> §2 is current.
