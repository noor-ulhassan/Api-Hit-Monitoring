# 1 · Concepts the schemas assume

Read once; every model file below leans on these.

---

## ODM — why use one against a schemaless database

MongoDB stores arbitrary BSON; it does not enforce a shape. **Mongoose** is an
Object Document Mapper: a layer that adds a declared schema, type coercion,
validation, lifecycle hooks (`pre`/`post` middleware), instance/static methods,
and `populate()` for resolving references.

The value: the shape contract lives in **one place, checked on every write**,
instead of trusting every call site. The cost: a second schema definition to
keep in sync, and behaviour (casting, defaults, validator timing) that is
Mongoose's, not MongoDB's.

## Three layers of validation

1. **Schema declarations** — `required`, `unique`, `minlength`, `maxlength`,
   `match`, `enum`, `min`/`max`. Cheap, declarative, enough for structure.
2. **Inline `validate` functions** — custom predicates on a field (username
   character-set, email regex, IP/origin format).
3. **An external policy object** — `SecurityUtils.validatePassword`, called from
   inside the `User.password` validator.

The password policy is pulled out on purpose: a controller or a test may need to
validate a candidate password and get back a list of specific failures **without
constructing a `User` at all**. A rule buried in a schema validator cannot be
called from outside the model; a static method on a plain class can, and is
unit-testable with no database.

## Validator timing vs middleware timing

Mongoose runs `save()` work in this order:

```
pre('validate')  →  validation  →  pre('save')  →  write
```

So the `User.password` **validator sees the plaintext**, and the `pre('save')`
hook that bcrypt-hashes it runs **after**. That ordering is what lets one
`save()` "validate the plaintext, then store only the hash".

Complication: `save()` can be called again on a doc whose `password` already
holds a hash. Two guards are needed; only one is built (the validator checks
`!password.startsWith("$2a$")` — which is also the *wrong* prefix for bcryptjs 3;
see issues).

## Hashing at rest

`bcrypt.genSalt(10)` then `bcrypt.hash(plaintext, salt)`. Cost factor `10` =
`2^10` rounds per hash, deliberately slow to make offline brute-force expensive.
The salt is per-password and stored *inside* the hash string, so equal passwords
get different hashes and rainbow tables do not apply. Plaintext is never stored
and never compared directly — verifying means `bcrypt.compare(candidate, hash)`.

## Multi-tenancy and the partition key

`Client` is the tenant. `User`, `ApiKey`, `ApiHit` each carry a `clientId`.
Every tenant-scoped read and access check is assumed to filter by it — which is
why `clientId` is the **first field in almost every compound index**. A
`super_admin` is the one row allowed to have no `clientId` (platform staff are
not tenants): `required: function () { return this.role !== "super_admin" }`.

## Compound indexes — the prefix rule and ESR

A compound index on `(a, b, c)` is one sorted structure keyed by `a`, then `b`,
then `c`. It serves queries on a **left prefix** (`a`; `a,b`; `a,b,c`) but not
`b` alone. Field order follows **ESR**: **E**quality-matched fields first, then
the field you **S**ort on, then **R**ange fields. So
`{ clientId, serviceName, endpoint, timestamp: -1 }` answers "most recent hits
for this client + service + endpoint" from the index alone.

## TTL indexes

An index on a single `Date` field with `expireAfterSeconds: N` makes a MongoDB
background thread delete any document once `indexedDate + N < now`. Two uses
here, with different meanings:

- `ApiHits { timestamp: 1 }, 2592000` (30 days) — **raw events are disposable**;
  aggregates are the durable record.
- `ApiKey { expiresAt: 1 }, 0` — the **key document itself** vanishes the instant
  it expires. Much stronger than "the key stops working", and it destroys the
  audit trail (an Issue).

## Public identifiers vs `_id`

`ApiHits.eventId`, `ApiKey.keyId`, `ApiKey.keyValue` are `String`, `required` +
`unique`, separate from Mongo's `_id`. Reason: `_id` is a roughly-sequential DB
primary key you do not want in URLs, logs, or message payloads (enumeration; and
you may change stores later). Nothing generates these yet.
