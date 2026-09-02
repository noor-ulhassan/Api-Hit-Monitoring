# 4 · `scripts/init.postgres.sql` — the `endpoint_metrics` rollup

**Mental model:** a scoreboard. One row per (client, service, endpoint, method,
hour). The consumer bumps counters as hits arrive; dashboards read the
scoreboard instead of re-counting the crowd.

---

**What we did.** The file was empty since Phase 1. It now holds a full schema for
one table, `endpoint_metrics`: columns, a composite `UNIQUE` constraint, four
indexes, a trigger function, and the trigger that uses it. Idempotent throughout
(`IF NOT EXISTS` / `OR REPLACE`).

**What it does.** Run against Postgres, it creates a table storing **one
pre-aggregated row per (client, service, endpoint, method, time bucket)**. Each
row carries running totals (`total_hits`, `error_hits`) and latency stats
(`avg_latency`, `min_latency`, `max_latency`). The trigger refreshes
`updated_at` on every `UPDATE`.

**Why it exists.** Scanning millions of raw `ApiHits` docs per dashboard load
does not scale. The rollup is meant to be maintained as hits arrive — for each
hit, find-or-create its bucket row, bump `total_hits`, bump `error_hits` on an
error status, fold latency into `avg/min/max`. Nothing writes it yet (no
consumer).

**Column by column:**

- **Grouping key** — `client_id`, `service_name`, `endpoint`, `method`,
  `time_bucket`. `time_bucket` stores the *start* of the interval
  (`10:25 → 10:00`).
- **`UNIQUE(...)` on those five** — the upsert target
  (`INSERT ... ON CONFLICT ... DO UPDATE`). Without it, "increment the existing
  bucket" is a read-then-write race.
- **`NUMERIC(10,3)` for latencies**, not `float` — fixed-point, so repeatedly
  folding values in does not accumulate binary floating-point drift.
- **`client_id VARCHAR(24)`** — a Mongo ObjectId as a hex string. Different
  database from the `Client` doc it points at, so no foreign key possible; an
  opaque cross-store pointer the consumer must keep honest (Issue — no CHECK).
- **Four indexes** — `client_id`; `(client_id, service_name)`; `time_bucket`;
  `(client_id, service_name, endpoint)` — the obvious read patterns, same
  left-prefix logic as the Mongo compound indexes.
- **`updated_at` trigger** — SQL has no auto-timestamps; a `BEFORE UPDATE` row
  trigger sets `NEW.updated_at = CURRENT_TIMESTAMP`. `created_at` needs only its
  column `DEFAULT`.

> The filename was `init.postgress.sql` (double "s") vs the compose mount
> `init.postgres.sql`, so it never ran. **Renamed in Phase 5** — see
> [../phase-5-running-and-docker/2-getting-postgres-connected.md](../phase-5-running-and-docker/2-getting-postgres-connected.md)
> for the operational mess that fix uncovered.
