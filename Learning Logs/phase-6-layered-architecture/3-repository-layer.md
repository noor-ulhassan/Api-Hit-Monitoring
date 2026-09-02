# 3 · The repository layer

**Mental model:** the only door to the database. The service knocks with intent
("find all users", "create this user"); what's on the other side — Mongoose,
SQL, a fake — is hidden.

---

## `repository/BaseRepository.js`

**What we did.** An abstract class: constructor stores `this.model = model`; five
async methods (`create`, `findById`, `findByUsername`, `findByEmail`, `findAll`)
each `throw new Error("Method not implemented")`.

**What it does.** Nothing at runtime — every method is overridden by the
subclass. It documents the contract: *a repository is something with these five
methods and a `model`.*

**Why.** A stand-in for a missing language feature. With no `interface` in JS,
the "throwing base class" is how you write down "subclasses must implement
these", with a clear error if one forgets.

**Wiring.** Extended by `UserRepository.js`. Imports nothing.

---

## `repository/UserRepository.js`

**What we did.** `MongoUserRepository extends BaseRepository`. `super(User)`
passes the Mongoose model up. All five methods overridden with real Mongoose
calls, each wrapped in try/catch that logs and re-throws. Exports
`new MongoUserRepository()` — a singleton instance, matching the connection
modules.

**What it does, method by method:**

- **`create(userData)`** — copies the input; **if** `role === "super_admin"` and
  no `permissions` supplied, fills all four permission booleans `true`; then
  `new this.model(data)` + `save()` (triggers `User`'s `pre('save')` password
  hash); returns the saved doc.
- **`findById` / `findByUsername` / `findByEmail`** — one `findById` /
  `findOne({...})` each; return the doc or `null`.
- **`findAll()`** — `find({ isActive: true }).select("-password")` — active users
  only, hash omitted.

**Why.** This is the **only file allowed to import `User` for writing**. The
service asked to "create a user"; how that becomes a Mongoose document —
including the super-admin permission defaulting — is the repository's private
business.

**Wiring.** Imports `BaseRepository`, the `User` model, `logger`. Its instance
goes into the container as `repositories.userRepository` and is handed to
`AuthService`.

**Seams worth noting:**

- The super-admin permission block hard-codes the literal `"super_admin"` (not
  `APPLICATION_ROLES.SUPER_ADMIN`) — a fourth copy of the string (Issue).
- `findAll()` does double duty: "list users" *and* "does any user exist" for the
  onboard check — which is why that check is really "any user exists", not "a
  super admin exists" (Issue).
- `BaseRepository` promises `findByUsername` / `findByEmail`, but nothing calls
  them yet — the login flow that needs them doesn't exist.
