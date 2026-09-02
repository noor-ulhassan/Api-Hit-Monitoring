# 4 · The service layer — `service/authService.js`

**Mental model:** the feature, minus the HTTP. `onboardSuperAdmin` *is* the
whole "create the first admin" story — and it could run from a CLI script
unchanged.

---

**What we did.** `AuthService` class. Constructor takes `userRepository`, throws
`"User Repository is required"` if absent, stores it. Three methods:

- **`generateToken(user)`** — destructures `_id, email, username, role, clientId`
  off `user`, builds a payload (`userId: _id`, ...), returns
  `jwt.sign(payload, config.jwt.sercet, { expiresIn: config.jwt.expiresIn })`.
- **`formatUserForResponse(user)`** — `user.toObject()` (or a shallow copy), then
  `delete userObj.password`; returns the plain object.
- **`onboardSuperAdmin(superAdminData)`** — `findAll()`; if non-empty, `throw new
  AppError("Super Admin already exists", 403)`; else `create(...)`,
  `generateToken(...)`, log, return `{ token, user: formatUserForResponse(user) }`.
  Wrapped in try/catch that logs and re-throws.

**What it does.** Encodes the one rule (single super admin) and owns token
creation and response shaping. It never sees `req` or `res`.

**Why it is built this way.** So the rule is testable in isolation and reusable
(a seed script could call `onboardSuperAdmin` directly). The constructor guard
(`throw` on a missing repository) makes the dependency explicit and the class
easy to fake in a test.

**Wiring.** Imports `AppError`, `jsonwebtoken`, `config`, `logger`. Constructed
by the container with the user repository. Called by `AuthController`.

**Bugs in this file (see [../OPEN-ISSUES.md](../OPEN-ISSUES.md)):**

- **`onboardSuperAdmin` calls `this.generateToken()` with no argument.** The
  method destructures `user` immediately → `TypeError: Cannot destructure
  property '_id' of 'undefined'`. The onboard flow **cannot succeed** as
  written. Fix: `this.generateToken(user)`.
- Reads `config.jwt.sercet` — the propagated Phase 1 typo, now load-bearing here
  and in `authenticate.js`.
- `userId: _id` puts a Mongoose `ObjectId` in the payload; it round-trips to a
  string on verify — document it or `String(_id)`.
- The "already exists" check is really "any active user exists" (uses
  `findAll()`), not "a super admin exists".
