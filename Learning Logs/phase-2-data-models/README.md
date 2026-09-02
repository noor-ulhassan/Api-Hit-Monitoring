# Phase 2 — Data models and the security utility

**One line:** the shape and rules of the data — one password-policy class and
four Mongoose schemas.

**Commits:** `b5a1460` → `96ab4e2`  **Dates:** 27–29 Aug 2026

**State after this phase:** five files carry real logic. **Nothing imports
them.** No `mongoose.model` runs at boot, no route touches a model, the consumer
does not exist. A broken import path inside two models has not thrown only
because nothing loads them. The Phase 1 plan of "accounts in PostgreSQL" is
gone — every model here is MongoDB.

---

## Files this phase touched

```
server/src/shared/
├─ utils/SecurityUtil.js     password policy + validatePassword(pw) → {success, errors[]}
└─ models/
   ├─ User.js       dashboard account. pre('save') hashes password; role enum;
   │                permissions block; clientId (required unless super_admin)
   ├─ Client.js     the tenant. everything else carries a clientId → here.
   │                settings sub-doc (retention / alerts / timezone)
   ├─ ApiKey.js     the ingest credential. keyId + keyValue, permissions,
   │                IP/origin allow-lists, expiry TTL. LARGEST schema.
   └─ ApiHits.js    one flat doc per tracked call. 4 analytics indexes + 30-day TTL
```

## Read in this order

1. **[1-concepts.md](1-concepts.md)** — ODM, the three validation layers, the
   hashing lifecycle, compound indexes + ESR, TTL indexes, public ids. The
   schemas assume all of it.
2. **[2-security-util.md](2-security-util.md)** — the password policy, extracted
   from the model so a controller can call it.
3. **[3-user-model.md](3-user-model.md)**
4. **[4-client-model.md](4-client-model.md)**
5. **[5-apikey-model.md](5-apikey-model.md)**
6. **[6-apihits-model.md](6-apihits-model.md)**

## The gist

- **Mongoose = the shape contract, checked on every write.** Worth a second
  schema definition to keep in sync.
- **Validation in three layers:** schema declarations (`required`, `enum`),
  inline `validate` functions, and an external policy class (`SecurityUtils`)
  that a controller can reuse without building a `User`.
- **`clientId` is the multi-tenancy partition key** — on `User`, `ApiKey`,
  `ApiHit`; first field of nearly every compound index; the axis of every
  future access check. `super_admin` is the one row allowed to have none.
- **Compound index field order follows ESR** — Equality fields, then Sort, then
  Range.
- **TTL indexes** auto-delete old documents: raw `ApiHits` after 30 days;
  `ApiKey` documents the instant they expire (too aggressive — Issue).
- **Storage direction reversed here:** `User` / `Client` / `ApiKey` are now
  MongoDB, not PostgreSQL. Phase 1 §3 carries the dated correction.

## Issues opened here

18 items — see [../OPEN-ISSUES.md](../OPEN-ISSUES.md). The load-bearing ones:
the `SecurityUtils.js` import path is wrong (file is `SecurityUtil.js`);
`ApiKey` cannot be saved (`keyId` / `keyValue` have no generator);
`User.password` is returned by default queries (no `select: false`); the `$2a$`
hash guard does not match bcryptjs 3's `$2b$`.
