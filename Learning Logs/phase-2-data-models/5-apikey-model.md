# 5 · `models/ApiKey.js`

**Mental model:** the credential a client's backend sends on every ingest call.
The schema's shape *is* the checklist the ingest path will run: match the
secret, confirm it's live, check permissions and allow-lists, check expiry. The
largest schema in the phase — and as written it can't be saved.

---

**What we did.** Field groups: identity (`keyId`, `keyValue`), ownership
(`clientId`, `createdBy`), labels (`name`, `description`), `environment`, a
`permissions` block, a `security` block (IP / origin allow-lists, rotation
tracking), `expiresAt`, and a `metadata` block. Four compound indexes plus an
`isExpired()` instance method. `timestamps: true`, `collection: "api_keys"`.

**What it does.** Describes an ingest credential. As written, `new
ApiKey(...).save()` **fails validation** — `keyId` and `keyValue` are `required`
but nothing generates them (Issue).

**Field groups and why:**

- **`keyId` / `keyValue`** — `keyId` is the public, safe-to-log id; `keyValue` is
  the secret sent on requests. Both `required` + `unique` + `index`. `keyValue`
  is stored **as-is, no hashing hook** — contradicts the Phase 1 plan ("store
  only a hash of each key"). A security gap for later.
- **`clientId`** — `ref: "Client"`, required, indexed. The owning tenant.
- **`environment`** — `enum(production | staging | development | testing)`,
  default `production`. Lets a client split traffic by deployment stage in
  analytics.
- **`permissions`** — `canIngest` (default true), `canReadAnalytics` (default
  false), `allowedServices` (string array; empty = "any"). Ingest-only unless
  read is explicitly granted.
- **`security.allowedIPs` / `allowedOrigins`** — allow-lists with format
  validators; `0.0.0.0/0` and `*` are the explicit "allow all" hatches. The IP
  regex checks digit-and-dot shape only, not octet ranges (Issue).
- **`security.lastRotated` + `rotationWarningDays`** — support a "this key is
  old, rotate it" nudge. No rotation code.
- **`expiresAt`** — default `now + API_KEY_EXPIRY_DAYS` (env, default 365),
  computed per document. Reads `process.env` directly (Issue).
- **`metadata.createdBy` / `purpose` / `tags`** — optional provenance;
  `metadata.createdBy` duplicates the top-level required `createdBy` (Issue).

**Indexes:**

- `{ clientId, isActive }` — active keys for a tenant.
- `{ keyValue, isActive }` — **the auth lookup on every ingest request**: match
  the secret and confirm it's live in one index hit.
- `{ environment, clientId }` — filter a tenant's keys by stage.
- `{ expiresAt: 1 }, expireAfterSeconds: 0` — a **TTL index that deletes the key
  document at expiry**. Too aggressive: no history of which keys existed, and
  `isExpired()` becomes almost unobservable (Issue). Prefer a job that sets
  `isActive: false` and keeps the row.
