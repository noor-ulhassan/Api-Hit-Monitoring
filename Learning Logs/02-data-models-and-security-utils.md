# 02 - Data Models and the Security Utility

**Covers commits:** `b5a1460` (Model files and Logs for Understanding) through
`96ab4e2` (Security Utils & 4 Database Models).
**Date range of work:** 27 Aug 2026 - 29 Aug 2026.
**State of the app at end of this phase:** five files now carry real logic -
four Mongoose schemas and one password-policy class. Nothing imports them yet.
`server.js` is still the stub from Phase 01, no model is registered at boot, no
route touches a model, and the consumer does not exist. Because nothing imports
the models, a broken import path inside two of them (see Issue 1) has not thrown
yet. The PostgreSQL model layer that Phase 01 planned (section 3, "Why two
databases") has been dropped without a note: `User`, `Client`, and `ApiKey` are
now MongoDB documents, `scripts/init.postgress.sql` is still empty, and
`config/postgres.js` is no longer referenced by anything.

The code is in git. This file is for the reasoning that is not: why each schema
is shaped the way it is, which decisions are load-bearing, and what was traded
away or deferred.

---

## 1. Scope

This phase defines the data layer:

- `src/shared/utils/SecurityUtil.js` - a stateless class holding the password
  policy and its validator, kept separate from any model so routes can reuse it.
- `src/shared/models/User.js` - dashboard accounts, with password hashing and a
  role plus a per-capability permission block.
- `src/shared/models/Client.js` - the tenant (an organisation using the
  service); everything else hangs off a `clientId`.
- `src/shared/models/ApiKey.js` - credentials a client's backend presents on the
  ingest path, with environment, permissions, IP/origin allow-lists, and an
  expiry.
- `src/shared/models/ApiHits.js` - one document per tracked API call; the
  high-volume append-only stream.

No routes, no controllers, no auth middleware, no aggregation models. This is
shape and rules only.

---

## 2. Context: what changed since Phase 01

Phase 01 committed to **polyglot persistence**: PostgreSQL for accounts, clients,
and keys (relational, correctness-critical); MongoDB only for the hit stream and
its aggregates. Section 3 of the Phase 01 log spends a table justifying it.

This phase does not follow that. Every model here is
`mongoose.Schema` + `mongoose.model(...)`. `Client.js:4` even carries the comment
"MongoDB schema for clients/organizations". Consequences:

- `scripts/init.postgress.sql` (already misnamed, Phase 01 Issue 10) is now not
  just empty but unused - there is no relational schema to bootstrap.
- `config/postgres.js`, its pool, its smoke test, and the `pg` dependency are
  dead weight until something else needs SQL.
- Cross-model references (`clientId`, `createdBy`, `apiKeyId`) are now all
  `ObjectId` references inside one Mongo database, resolvable with
  `populate()` - but with **no foreign-key enforcement** (MongoDB has none).
  Referential integrity becomes an application responsibility (Issue 18).

This is a legitimate simplification for a tutorial - one datastore to run, one
query language, `populate()` instead of joins - but it is a reversal of a
documented decision. Either update the Phase 01 architecture section with a dated
correction, or treat the move as provisional and plan the migration back. It
must not stay undocumented.

---

## 3. Concepts introduced this phase

Anchored from first principles, because the schemas assume all of them.

### 3a. ODM, and why use one against a schemaless database

MongoDB stores arbitrary BSON documents; it does not enforce a shape. **Mongoose**
is an Object Document Mapper: a layer between the app and the driver that adds a
declared schema, type coercion, validation, lifecycle hooks (`pre`/`post`
middleware), instance/static methods, and `populate()` for reference resolution.

The value is putting the shape contract in **one place, checked on every write**,
instead of trusting every call site to build correct documents. The cost is a
second schema definition to keep in sync with reality, and behaviour (casting,
default application, validator timing) that is Mongoose's, not MongoDB's.

### 3b. Three layers of validation, and why the policy is extracted

Each model validates at up to three levels:

1. **Schema declarations** - `required`, `unique`, `minlength`, `maxlength`,
   `match`, `enum`, `min`/`max`. Cheap, declarative, and enough for structural
   rules.
2. **Inline `validate` functions** - custom predicates on a field (the username
   character-set check, the email regex, the IP/origin format checks).
3. **An external policy object** - `SecurityUtils.validatePassword`, called from
   inside the `User.password` validator.

The password policy is pulled out of the model on purpose. The registration
route will need to validate a candidate password and return a list of specific
failures *before* it ever constructs a `User`. A rule buried in a schema
validator cannot be called from a controller; a static method on a plain class
can, and can be unit-tested with no database. The class docstring states the
intent to grow it into token generation, key generation, and encryption - it is
the future home for anything security-shaped that more than one model or route
needs.

### 3c. Validator timing vs middleware timing (the reason for the `$2a$` guard)

Mongoose runs document work in this order on `save()`:

```
pre('validate')  ->  validation  ->  pre('save')  ->  write
```

So the `User.password` **validator sees the plaintext password**, and the
`pre('save')` hook that bcrypt-hashes it runs **afterwards**. That ordering is
what makes "validate the plaintext, then store only the hash" work in one
`save()`.

The complication: `save()` can be called again on a document whose `password`
field already holds a hash. Two defences are needed and only one is fully built:

- The validator guards with
  `this.isModified("password") && !password.startsWith("$2a$")` so an existing
  hash is not run through `validatePassword` as though it were a new plaintext.
- The `pre('save')` hook guards only with `if (!this.isModified("password"))`.

Both guards are incomplete - see Issue 7. The prefix check is also wrong for the
installed bcrypt (Issue 7 again).

### 3d. Hashing at rest

`bcrypt.genSalt(10)` then `bcrypt.hash(plaintext, salt)` in `pre('save')`. The
cost factor `10` means `2^10` key-expansion rounds per hash - deliberately slow,
to make offline brute-force expensive. The salt is per-password and stored
inside the resulting hash string, so two users with the same password get
different hashes and precomputed-table attacks do not apply. Plaintext is never
stored and never compared directly; login will call `bcrypt.compare(candidate,
storedHash)`. Note the field is still selectable by default (Issue 4) and no
`comparePassword` helper exists yet (Issue 5).

### 3e. Multi-tenancy and the partition key

`Client` is the tenant. `User`, `ApiKey`, and `ApiHit` each carry a `clientId`.
Every analytics query and every access check will filter by it, so `clientId` is
the **first field in almost every compound index** in this phase. A
`super_admin` user is the one row allowed to have no `clientId` - platform staff
are not tenants - expressed as `required: function () { return this.role !==
"super_admin"; }`.

### 3f. Compound indexes: the prefix rule and ESR

A compound index on `(a, b, c)` is a single sorted structure keyed by `a`, then
`b`, then `c`. It can serve queries that use a **left prefix** of those keys
(`a`; `a, b`; `a, b, c`) but not, say, `b` alone. Field order is therefore a
design decision, guided by **ESR**: **E**quality-matched fields first, then the
field used for **S**ort, then **R**ange fields. So
`{ clientId: 1, serviceName: 1, endpoint: 1, timestamp: -1 }` answers "the most
recent hits for this client, service, and endpoint" from the index alone -
equality on the first three, descending sort on the last.

### 3g. TTL indexes

An index built on a single `Date` field with `expireAfterSeconds: N` makes a
MongoDB background thread delete any document once
`indexedDate + N < now`. Two uses appear here, with different meanings:

- `ApiHits`: `{ timestamp: 1 }, expireAfterSeconds: 2592000` (30 days) -
  **raw events are disposable**; aggregates (not yet modelled) are the durable
  record. This is the Phase 01 plan.
- `ApiKey`: `{ expiresAt: 1 }, expireAfterSeconds: 0` - the **key document
  itself** is deleted the instant `expiresAt` passes. That is a much stronger
  claim than "the key stops working" and it destroys the audit trail (Issue 9).

`expireAfterSeconds: 0` means "expire exactly at the stored time"; any positive
value is an added grace period.

### 3h. Public identifiers vs `_id`

`ApiHits.eventId`, `ApiKey.keyId`, and `ApiKey.keyValue` are `String` fields
marked `required` + `unique`, separate from Mongo's `_id` ObjectId. The reason
to carry an app-level ID: `_id` is a database primary key, roughly sequential,
and you generally do not want it in URLs, logs, or message payloads where it can
be enumerated or where you may later change stores. Nothing generates these
values yet (Issue 8).

---

## 4. Walkthrough - `SecurityUtil.js`

Each walkthrough below runs the same pass: **what we did**, **what it does**,
**why it is built that way**. Bugs are detailed in section 11.

**What we did.** Added `src/shared/utils/SecurityUtil.js`: one class,
`SecurityUtils`, with no instances - a static config object
(`PASSWORD_REQUIREMENTS`) and one static method (`validatePassword`).

**What it does.** `SecurityUtils.validatePassword("hunter2")` returns
`{ success: false, errors: [ "Password must be at least 8 chars long!", ... ] }`
- a boolean plus every rule the password broke. The `User` model calls it from
its password validator, and the registration route will call it directly so it
can reject a weak password with specific reasons *before* a `User` is
constructed.

**Why it is built this way.**

`PASSWORD_REQUIREMENTS` is read from `process.env` **at module load time**
(`PASSWORD_MIN_LENGTH`, `PASSWORD_REQUIRE_UPPERCASE`, and three siblings), each
with a hard-coded default and `=== "true"` string coercion - the same boolean
pattern Phase 01 used for `RABBITMQ_PUBLISHER_CONFIRMS`. Because it is evaluated
at import, `dotenv` must have run first; and because it reads `process.env`
directly it violates the Phase 01 rule that only `config/index.js` may do so
(Issue 3).

`validatePassword(password)` returns `{ success, errors }` where `errors` is an
array of specific, human-readable strings. Design points worth keeping:

- **Accumulate, do not fail fast.** Every unmet rule is pushed, so the caller can
  show the user all problems at once. Only the empty-input case short-circuits.
- **`success` is derived** as `errors.length === 0`, never set directly - one
  source of truth.
- **The weak-password list is a lowercased exact-match check.** It catches
  `Password123` only because that literal is in the list; `P@ssw0rd!` passes.
  This is a token gesture, not a real breached-password check (that would need a
  large dataset or a k-anonymity API). Documented as good-enough for the
  tutorial.
- `this.PASSWORD_REQUIREMENTS` inside a static method resolves via the class -
  fine, but a direct `SecurityUtils.PASSWORD_REQUIREMENTS` reference would be
  clearer.

The `User` model consumes this in two places: the validator returns
`validation.success` (a boolean, as Mongoose requires) and the `message`
function re-runs the validator to turn `errors` into one
`"Rule one. Rule two."` sentence. Re-running the validator to build the message
is slightly wasteful but keeps the message text and the pass/fail logic from
drifting apart.

---

## 5. Walkthrough - `User.js`

**What we did.** Filled the empty `User.js` with a Mongoose schema and model for
a dashboard account. Fields: `username`, `email`, `password`, `role`, `clientId`,
`isActive`, and a `permissions` sub-document of four booleans. Plus a
`pre('save')` hook and two secondary indexes. `timestamps: true`,
`collection: "users"`.

**What it does.** On `new User({...}).save()`, Mongoose validates every field
(character-set on `username`, format on `email`, the `SecurityUtils` policy on
`password`), then the `pre('save')` hook bcrypt-hashes the password before the
document is written. Querying returns the account including the password hash
(there is no `select: false` yet - Issue 4). It is not imported anywhere yet, so
none of this has run.

**Why each decision:**

- **`username` character-set validator** (`/^[a-zA-Z0-9_.-]+$/`) on top of
  `minlength: 3` and `unique: true`. Keeps usernames safe to drop into URLs,
  log lines, and `@mentions` without escaping.
- **`email` is `lowercase: true` + `trim: true` + a format regex.** Lowercasing
  at the schema level is what makes `unique: true` actually mean "one account
  per address" - otherwise `A@x.com` and `a@x.com` coexist. The regex is the
  deliberately loose `something@something.something`; full RFC 5322 validation is
  not worth it, a confirmation email is the real check.
- **`password` schema `minlength: 6` but the policy default is 8.** The schema
  check runs first and is looser, so the effective minimum is 8 whenever the
  policy is active. Harmless, but two numbers that disagree (Issue 6).
- **The `password` validator guards with `!password.startsWith("$2a$")`** so an
  already-hashed value assigned to the field is not validated as a new
  plaintext. The installed `bcryptjs@^3.0.3` emits `$2b$`, so this guard does
  not match its own hashes (Issue 7).
- **`role` is a three-value enum** (`super_admin`, `client_admin`,
  `client_viewer`) defaulting to the least privileged, `client_viewer`.
- **`clientId` is conditionally required** - present for everyone except
  `super_admin` (see 3e). It is `ref: "Client"` for `populate()`.
- **`permissions` is a fixed block of four named booleans**, not a free-form
  array of strings. Named fields get schema defaults, typo protection, and
  indexable paths; a `["can_x", "can_y"]` array gets none of that. The defaults
  encode "a viewer can view analytics and nothing else". The overlap between
  this block and `role` is unresolved (Issue 12).
- **`pre('save')` hashing hook** re-checks `isModified("password")` and calls
  `next(error)` on failure so a bad hash aborts the save instead of writing
  plaintext.
- **Two secondary indexes**: `{ clientId: 1, isActive: 1 }` for "active users in
  this tenant" (the common admin list) and `{ role: 1 }` for "find the
  super_admins".

Missing: `select: false` on `password`, a `toJSON` transform to strip it, and a
`comparePassword` instance method (Issues 4, 5).

---

## 6. Walkthrough - `Client.js`

**What we did.** Filled `Client.js` with a Mongoose schema and model for a
tenant - one organisation using the monitoring service. Fields: `name`, `slug`,
`email`, `description`, `website`, `createdBy`, `isActive`, and a `settings`
sub-document (`dataRetentionDays`, `alertsEnabled`, `timezone`). One index on
`isActive`. `timestamps: true`, `collection: "clients"`.

**What it does.** It is the row everything else points at: `User.clientId`,
`ApiKey.clientId`, and `ApiHit.clientId` are all references to a `Client._id`.
`settings` is where per-tenant behaviour (retention window, alerting, report
timezone) will be read from. On `save()` it enforces the `slug` format and the
required `createdBy`. Not wired up yet.

**Why each decision:**

- **`slug` is `unique`, `lowercase`, `trim`, and `match: /^[a-z0-9-]+$/`.** It is
  the URL- and config-safe handle for the tenant (`/clients/acme-corp`). The
  regex bans spaces, underscores, and capitals so the slug is stable and
  canonical. Nothing generates it from `name` yet - it must be supplied
  (Issue 17 covers what else is under-validated here).
- **`createdBy` is a required `ref: "User"`.** Every tenant is traceable to the
  account that created it. Combined with `User.clientId` being required for
  non-admins, this creates a bootstrap ordering: the first `Client` can only be
  created by a `super_admin` (Issue 16).
- **`settings.dataRetentionDays`** defaults to 30, bounded 7-365. The intent is
  per-tenant control of how long raw hits are kept - but the `ApiHits` TTL is a
  single global 30-day index and never reads this value (Issue 10).
- **`settings.alertsEnabled`, `settings.timezone`** are declared now so alerting
  and time-bucketed reporting have somewhere to read from later.
- **One index**: `{ isActive: 1 }` to list live tenants.
- **`email` has no format validator** (unlike `User.email`) and **`website`
  accepts any string** - inconsistent with the care taken elsewhere (Issue 17).

---

## 7. Walkthrough - `ApiKey.js`

**What we did.** Filled `ApiKey.js` with the largest schema in this phase - the
credential a client's backend presents on every ingest call. Field groups:
identity (`keyId`, `keyValue`), ownership (`clientId`, `createdBy`), labels
(`name`, `description`), `environment`, a `permissions` block, a `security` block
(IP / origin allow-lists, rotation tracking), `expiresAt`, and a `metadata`
block. Four compound indexes plus an `isExpired()` instance method.
`timestamps: true`, `collection: "api_keys"`.

**What it does.** It is the lookup target on the ingest hot path: a request
arrives with a key, the server finds the `ApiKey` by `keyValue`, checks
`isActive`, `permissions.canIngest`, the IP / origin allow-lists, and `expiresAt`
before accepting the hit. The `{ expiresAt: 1 }` TTL index also makes Mongo
delete the key document itself once it expires (Issue 9). As written the model
cannot actually be saved - `keyId` and `keyValue` are `required` but nothing
generates them (Issue 8).

**Field groups and why they exist:**

- **`keyId` and `keyValue`** - `keyId` is the public, safe-to-log identifier;
  `keyValue` is the secret presented on requests. Both `required` + `unique` +
  `index: true`. Nothing generates them and `keyValue` is stored as-is with no
  hashing hook - contradicting the Phase 01 plan ("store only a hash of each
  key"). Both are latent (Issue 8) and a security gap for later.
- **`clientId`** - `ref: "Client"`, required, indexed. The tenant this key
  belongs to.
- **`name`, `description`** - human labels for the dashboard's key list.
- **`environment`** - enum `production | staging | development | testing`,
  default `production`. Lets one client separate traffic by deployment stage in
  analytics.
- **`permissions`** - `canIngest` (default true), `canReadAnalytics` (default
  false), and `allowedServices` (a string array; empty means "any"). A key is
  ingest-only unless explicitly granted read access.
- **`security.allowedIPs` / `allowedOrigins`** - allow-lists with format
  validators. `0.0.0.0/0` and `*` are the explicit "allow all" escape hatches.
  The IP regex checks digit-and-dot shape only, not octet ranges (Issue 13).
- **`security.lastRotated` + `rotationWarningDays`** - support a "this key is old,
  rotate it" nudge in the UI. No rotation code yet.
- **`expiresAt`** - defaults to `now + API_KEY_EXPIRY_DAYS` (env, default 365),
  computed **per document at creation time** via a function default. Reads
  `process.env` directly (Issue 3).
- **`metadata.createdBy` / `purpose` / `tags`** - optional provenance. Note
  `metadata.createdBy` duplicates the top-level required `createdBy` (Issue 14).

**Indexes** - four compound plus the field-level ones:

- `{ clientId: 1, isActive: 1 }` - active keys for a tenant.
- `{ keyValue: 1, isActive: 1 }` - the auth lookup on every ingest request:
  match the secret and confirm it is live in one index hit.
- `{ environment: 1, clientId: 1 }` - filter a tenant's keys by stage.
- `{ expiresAt: 1 }, { expireAfterSeconds: 0 }` - a **TTL index that deletes the
  key document at expiry** (see 3g and Issue 9).

`apiKeySchema.methods.isExpired()` compares `expiresAt` to now. Given the TTL
index above, an expired key's document is usually already gone, so this method is
mostly useful in the seconds-to-minutes window before the background sweep runs.

---

## 8. Walkthrough - `ApiHits.js`

**What we did.** Filled `ApiHits.js` with a flat Mongoose schema for a single
tracked API call - the append-only stream from the Phase 01 architecture
diagram. Fields: `eventId` (unique public ID), `timestamp` (the caller's event
time, separate from the auto `createdAt` insert time), `serviceName`, `endpoint`,
`method` (enum of the seven HTTP verbs), `statusCode`, `latencyMs`, `clientId`,
`apiKeyId`, `ip`, `userAgent`. Four compound indexes, one of them a 30-day TTL.
`timestamps: true`, `collection: "api_hits"` - the same name as the RabbitMQ
queue, by intent.

**What it does.** This is the model the consumer will insert into once per
message it pulls off `api_hits`. Nothing references it, but no nested objects and
minimal validation mean an insert is as cheap as possible. The TTL index makes
Mongo drop each document 30 days after its `timestamp`, so the raw collection
stays bounded while the (not-yet-built) aggregates keep the long-term record.

**Why it looks the way it does:**

- **Everything the consumer receives is stored flat.** No nested objects, no
  references resolved at write time. The write path must be as cheap as possible
  (Phase 01, "A fast hot path"); enrichment and joins happen at read time in
  aggregation.
- **`timestamp` is client-supplied and required.** Analytics bucket by when the
  call happened, not when the queue drained. Keeping `createdAt` too lets you
  measure pipeline lag (`createdAt - timestamp`).
- **`method` is an enum**; `statusCode` is a free `Number` (there are too many
  valid codes to enumerate, and clients may proxy odd ones).
- **Heavy indexing, tuned to expected queries** (see 3f):
  - `{ clientId, serviceName, endpoint, timestamp: -1 }` - "recent calls to this
    endpoint".
  - `{ clientId, timestamp: -1, statusCode }` - "recent calls, sliceable by
    status" (error-rate-over-time).
  - `{ apiKeyId, timestamp: -1 }` - per-key usage.
  - `{ timestamp: 1 }, expireAfterSeconds: 2592000` - 30-day TTL purge.
- **The index count is a deliberate write-cost trade.** Every index is extra work
  on insert and extra storage. On a high-volume append-only collection that is
  significant, and the set here should be pruned to what the analytics endpoints
  actually issue once those exist.

The model is registered as `"ApiHit"` (singular) from file `ApiHits.js` into
collection `api_hits` - three spellings of one concept (Issue 15).

---

## 9. Cross-cutting design notes

### 9a. Indexing strategy as a whole

Two forces are in tension. Reads want an index for every query shape;
`ApiHits` writes want as few as possible. This phase leans read-heavy - four
indexes on the hottest-write collection - on the assumption that query patterns
will settle and the list will be cut. Revisit after the analytics endpoints are
written, not before.

### 9b. The authorization model is doubled

`User.role` (an enum) and `User.permissions` (four booleans) both express
authority, and `ApiKey.permissions` adds a third surface for keys. Nothing maps
between them: creating a `client_admin` does not set `canManageUsers`. Pick one
model as the source of truth - almost certainly "role implies a default
permission set, individual flags override" - and enforce it in a `pre('save')`
hook. Until then, every access check has to consult both and hope they agree
(Issue 12).

### 9c. Referential integrity is now the app's job

With Postgres gone, `clientId` / `createdBy` / `apiKeyId` are ObjectId pointers
with no database-level constraint. Deleting a `Client` leaves orphan `User`,
`ApiKey`, and `ApiHit` documents; nothing stops an `ApiKey` pointing at a
`clientId` that never existed. Either add cascade logic in service code, or
adopt soft deletes everywhere (`isActive: false`) and never hard-delete a
referenced document (Issue 18).

---

## 10. System-design concepts introduced this phase

- **ODM (Object Document Mapper).** App-side schema, validation, hooks, and
  reference resolution over a schemaless store.
- **Validation layering.** Structural rules in the schema; field predicates in
  `validate` functions; reusable policy in a standalone class a controller can
  call without a database.
- **Middleware ordering.** `validate` before `pre('save')`; the reason a
  plaintext password can be checked and then replaced with its hash in one
  `save()`.
- **Password hashing at rest.** Per-password salt, tunable cost factor, compare
  never decrypt.
- **Multi-tenancy partition key.** One `clientId` on every tenant-owned
  document; first field of nearly every index; the axis of every access check.
- **Compound index prefix rule + ESR.** An index on `(a,b,c)` serves left
  prefixes only; order fields Equality, then Sort, then Range.
- **TTL index.** A dated field plus `expireAfterSeconds`; a background thread
  deletes expired documents. Used for disposable raw events - and, more
  aggressively, to delete expired API-key records.
- **Public identifier vs primary key.** A separate app-level ID so the database
  `_id` stays out of URLs, logs, and message payloads.
- **Soft delete.** `isActive: false` instead of removing a row, to preserve
  history and referenced-by integrity.
- **RBAC vs capability flags.** Coarse role enum vs fine-grained boolean
  permissions; this phase has both and reconciles neither.

---

## 11. Issues, shortcuts, and TODO

Blunt list. Bugs found while writing this log, plus deferrals.

### Bugs to fix before the code is used

1. **Broken import path.** `User.js:3` and `ApiKey.js:2` import
   `"../utils/SecurityUtils.js"`; the file on disk is `SecurityUtil.js` (no
   trailing "s"). Under ESM this throws `ERR_MODULE_NOT_FOUND` the moment either
   model is loaded. It has not surfaced only because nothing imports the models
   yet. Fix: rename the file to `SecurityUtils.js` (matches the class name and
   both import sites).
2. **Polyglot-persistence plan abandoned silently.** Phase 01 section 3 put
   `User` / `Client` / `ApiKey` in PostgreSQL; all three are now Mongoose.
   `scripts/init.postgress.sql` is empty and `config/postgres.js` is unused.
   Add a dated correction to the Phase 01 log or record this as provisional.
3. **`process.env` read outside `config/index.js`.** `SecurityUtil.js:8-14`
   (five vars) and `ApiKey.js:103` (`API_KEY_EXPIRY_DAYS`) read the environment
   directly, breaking the single-boundary rule from Phase 01 section 6. Move
   these into the config object and import them.
4. **`User.password` is selectable.** No `select: false` and no `toJSON`
   transform, so `User.find()` returns the bcrypt hash in every payload. Add
   `select: false` and a `toJSON` that deletes `password`.
5. **No `comparePassword` method.** `User` hashes on save but offers no way to
   verify a candidate; login will re-implement `bcrypt.compare` elsewhere. Add
   `userSchema.methods.comparePassword`.
6. **Two disagreeing minimum lengths.** `User.password` schema `minlength: 6`
   vs `SecurityUtils` default `minLength: 8`. Align them.
7. **`$2a$` guard is wrong and incomplete.** `bcryptjs@^3.0.3` emits `$2b$`
   (verified), so `User.js:42` / `User.js:50` never recognise their own hashes.
   And the `pre('save')` hook guards only on `isModified("password")`, not on
   "already hashed", so assigning a pre-hashed value (a seed script, a data
   import) double-hashes it and makes login impossible. Use a general hash test
   such as `/^\$2[aby]\$\d{2}\$/` in both the validator and the hook.
8. **`ApiKey` cannot be created yet.** `keyId` and `keyValue` are `required` +
   `unique` but nothing generates them - no default, no `pre('validate')`, and
   `SecurityUtils` has no key-generation method. `new ApiKey(...).save()` fails
   validation. Also `keyValue` is stored in the clear; Phase 01 called for
   storing only a hash.
9. **`ApiKey` TTL deletes the key document.** `{ expiresAt: 1 },
   expireAfterSeconds: 0` purges the whole record at expiry - no history of
   which keys existed, and `isExpired()` becomes unobservable. Prefer a
   scheduled job that sets `isActive: false` and keeps the row.
10. **Global 30-day hit TTL ignores per-client retention.**
    `ApiHits` uses a fixed `expireAfterSeconds: 2592000`; `Client.settings
    .dataRetentionDays` (7-365) is never enforced. Per-document lifetimes need a
    precomputed `expireAt` field, not one global TTL index.
11. **Duplicate index definitions.** `unique: true` already builds an index;
    `keyId`, `keyValue` (`ApiKey`) and `eventId` (`ApiHits`) also set
    `index: true`. `ApiKey.expiresAt` has field-level `index: true` plus a
    separate `schema.index({ expiresAt: 1 }, ...)`. Mongoose logs "Duplicate
    schema index" for these. Drop the redundant `index: true`.
12. **RBAC and permission flags overlap with no source of truth.** `User.role`
    and `User.permissions.*` (and `ApiKey.permissions.*`) all encode authority;
    nothing maps role to flags. Decide the relationship and enforce it in a
    hook.
13. **Weak IP/CIDR validation.** `ApiKey.js:71` accepts `999.999.999.999/99`.
    Low priority while keys cannot be created.
14. **Redundant `createdBy` on `ApiKey`.** Both `metadata.createdBy` (optional)
    and top-level `createdBy` (required), both `ref: "User"`. Keep one.
15. **Naming drift.** File `ApiHits.js`, model `"ApiHit"`, collection
    `api_hits`. Not a bug; pick a convention.
16. **Bootstrap chicken-and-egg.** `Client.createdBy` requires a `User`;
    non-`super_admin` `User.clientId` requires a `Client`. Only a `super_admin`
    (no `clientId`) can create the first tenant. Document the seed path and,
    ideally, script it.
17. **`Client` under-validated.** `email` has no format validator (unlike
    `User.email`); `website` accepts any string; `slug` is not derived from
    `name`.
18. **No referential integrity.** ObjectId refs have no FK constraint. Deleting
    a `Client` orphans its `User` / `ApiKey` / `ApiHit` documents. Add cascade
    logic or enforce soft deletes on anything referenced.

### Carried over from Phase 01, still open

- `mongodb.js` bugs 1-3 (this-binding, event-name casing, exports the class not
  an instance) - now on the critical path, since every model needs that
  connection.
- `logger.js` bug 4 (`winston.combine`), `config/index.js` bugs 5-6
  (`jwt.sercet`, `"Development "`), `rabbitmq.js` bugs 7-8.
- Mongo port mismatch (compose 27018, `.env` 27017) - `.env` still says 27017.

### Deferred by design (not bugs)

- No routes, controllers, or auth middleware import these models.
- `server.js` still a stub; no `mongoose.model(...)` runs at boot.
- Aggregation / rollup collections from the Phase 01 architecture are not
  modelled - only raw `ApiHits`.
- `SecurityUtils` has only `validatePassword`; token generation, key generation,
  and encryption are named in its docstring as future work.

---

## 12. Commit history for this phase

| Commit | What landed and why |
|--------|---------------------|
| `b5a1460` Model files and Logs for Understanding | Commits the `Learning Logs/` folder (README + `01-...md`) and adds four **empty** model files as placeholders so imports and folder intent exist before the schemas are written. No behaviour change. |
| `96ab4e2` Security Utils & 4 Database Models | Fills all four models and adds `SecurityUtil.js`. `User` (hashing hook, role, permission block, conditional `clientId`), `Client` (tenant record, slug, per-tenant settings), `ApiKey` (secret + metadata + allow-lists + expiry TTL), `ApiHits` (flat event doc, four analytics indexes, 30-day TTL). All Mongoose - the PostgreSQL plan is dropped here. |

Working tree is clean at time of writing; everything in this phase is committed.

---

## 13. What comes next (expected)

1. **Fix the blockers**: rename `SecurityUtil.js` -> `SecurityUtils.js` (Issue
   1); fix the `mongodb.js` singleton/this-binding bugs (Phase 01 Issues 1-3);
   fix `logger.js` Issue 4. Nothing below runs until these are done.
2. **Decide and record the datastore direction** (Issue 2): commit to Mongo-only
   and correct the Phase 01 architecture, or plan the move back to Postgres for
   accounts.
3. **Fold the new env vars into `config/index.js`** (Issue 3) and add a
   `password` / `apiKey` section.
4. **Harden `User`**: `select: false` on `password`, a `toJSON` transform,
   `comparePassword`, and align the length minimums.
5. **Key generation in `SecurityUtils`**: generate `keyId` / `keyValue`, store a
   hash of the secret, expose it once on creation.
6. **`server.js` bootstrap**: load config, init logger, `mongoose.connect`,
   register the models, mount middleware and routes, add shutdown handlers.
7. **Auth**: register (calls `SecurityUtils.validatePassword` before building the
   `User`), login (`comparePassword`, issue JWT), verify middleware.
8. **Seed script** for the first `super_admin` and first `Client` (Issue 16).
9. **Ingest endpoint**: authenticate by `keyValue`, check `permissions.canIngest`
   and the IP/origin allow-lists, publish a hit message, return `202` fast.
10. **Consumer**: consume `api_hits`, batch-insert `ApiHit` documents, `ack` /
    `nack`-to-DLQ.
11. **Aggregation models + analytics endpoints**, then prune the `ApiHits`
    index set to what those queries actually use.
