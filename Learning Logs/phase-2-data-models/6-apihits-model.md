# 6 · `models/ApiHits.js`

**Mental model:** one flat row per tracked API call. Written by the (future)
consumer as fast as possible, read by analytics as aggregates, and auto-deleted
after 30 days so the raw pile stays bounded.

---

**What we did.** A flat Mongoose schema for a single tracked call. Fields:
`eventId` (unique public id), `timestamp` (the caller's event time, separate
from the auto `createdAt` insert time), `serviceName`, `endpoint`, `method`
(`enum` of the seven HTTP verbs), `statusCode`, `latencyMs`, `clientId`,
`apiKeyId`, `ip`, `userAgent`. Four compound indexes, one a 30-day TTL.
`timestamps: true`, `collection: "api_hits"` — the same name as the RabbitMQ
queue, by intent.

**What it does.** The model meant to receive one insert per message the consumer
pulls off `api_hits`. Nothing references it yet, but the flat structure and
minimal validation keep an insert as cheap as possible.

**Why it looks the way it does:**

- **Everything is stored flat** — no nested objects, no references resolved at
  write time. The write path must be as cheap as possible; enrichment and joins
  happen at read time in aggregation.
- **`timestamp` is client-supplied and required.** Analytics bucket by *when the
  call happened*, not when the queue drained. Keeping `createdAt` too lets you
  measure pipeline lag (`createdAt - timestamp`).
- **`method` is an `enum`; `statusCode` is a free `Number`** — too many valid
  codes to enumerate, and clients may proxy odd ones.
- **Four indexes, tuned to expected queries:**
  - `{ clientId, serviceName, endpoint, timestamp: -1 }` — recent calls to an
    endpoint.
  - `{ clientId, timestamp: -1, statusCode }` — recent calls sliceable by status
    (error-rate over time).
  - `{ apiKeyId, timestamp: -1 }` — per-key usage.
  - `{ timestamp: 1 }, expireAfterSeconds: 2592000` — the 30-day TTL purge.
- **The index count is a deliberate write-cost trade.** Every index is extra
  work per insert and extra storage. On a hot append-only collection that adds
  up — this set should be pruned to what analytics endpoints actually issue,
  once those exist.

**Naming drift (Issue):** file `ApiHits.js`, model `"ApiHit"`, collection
`api_hits` — three spellings of one concept.
