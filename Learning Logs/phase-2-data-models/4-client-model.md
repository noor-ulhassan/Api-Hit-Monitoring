# 4 · `models/Client.js`

**Mental model:** the tenant record — the row every `User`, `ApiKey`, and
`ApiHit` points back at via `clientId`. Also the home for per-tenant settings.

---

**What we did.** A Mongoose schema + model for a tenant (one organisation using
the service). Fields: `name`, `slug`, `email`, `description`, `website`,
`createdBy`, `isActive`, and a `settings` sub-document (`dataRetentionDays`,
`alertsEnabled`, `timezone`). One index on `isActive`. `timestamps: true`,
`collection: "clients"`.

**What it does.** It is the anchor: `User.clientId`, `ApiKey.clientId`,
`ApiHit.clientId` are all references to a `Client._id`. On `save()` it enforces
the `slug` format and the required `createdBy`. Not wired up.

**Why each decision:**

- **`slug`** — `unique`, `lowercase`, `trim`, `match: /^[a-z0-9-]+$/`. The URL-
  and config-safe handle for the tenant (`/clients/acme-corp`). The regex bans
  spaces, underscores, capitals so the slug is stable and canonical. Nothing
  derives it from `name` yet — it must be supplied (Issue).
- **`createdBy`** — required `ref: "User"`. Every tenant is traceable to the
  account that created it. Combined with `User.clientId` being required for
  non-admins, this makes a **bootstrap ordering**: the first `Client` can only
  be created by a `super_admin` (Issue — chicken-and-egg).
- **`settings.dataRetentionDays`** — default 30, bounded 7–365. *Intended* to
  control how long raw hits are kept per tenant — but the `ApiHits` TTL is a
  single global 30-day index that never reads this (Issue).
- **`settings.alertsEnabled` / `timezone`** — placeholders: fields with
  defaults, no code reads them.
- **`{ isActive: 1 }` index** — list live tenants.
- **`email` has no format validator** (unlike `User.email`) and **`website`
  accepts any string** — inconsistent with the care taken elsewhere (Issue).
