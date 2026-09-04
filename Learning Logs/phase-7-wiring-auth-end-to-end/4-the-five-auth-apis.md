# 4 · The five auth APIs, end to end

Each endpoint below is walked from the HTTP request to the HTTP response, through
every layer. The **status column** says whether it actually works today.

All live under `/api/auth` (`app.use("/api/auth", authRouter)` in `server.js`).

---

## `POST /api/auth/onboard-super-admin` ✅ works

**Purpose:** create the very first admin account, once, on a fresh system.

```
Client sends:  { username, email, password }

Chain:  requestLogger → validate(onboardSuperAdminSchema) → controller.onboardSuperAdmin

Controller (onboardSuperAdmin):
  reads req.body, adds role: "super_admin"
  → authService.onboardSuperAdmin({ username, email, password, role })

Service (onboardSuperAdmin):
  userRepository.count({ role: "super_admin" })      → MongoDB countDocuments
     if > 0  → throw AppError("Super Admin already exists", 403)
  userRepository.create(data)                        → new User(...).save()
     User.pre('save')  bcrypt-hashes the password (cost 10)
  generateToken(user)                                → jwt.sign({userId,email,username,role,clientId}, secret, 24h)
  formatUserForResponse(user)                        → toObject(), delete password
  returns { token, user }

Controller:
  res.cookie("authToken", token, { httpOnly, secure(prod), sameSite:"strict", maxAge:24h })
  res.status(201).json(ResponseFormatter.success(user, "Super Admin Onboarded Successfully", 201))

Client gets:  201 + Set-Cookie: authToken=... + { success:true, data:{user}, ... }
```

**Notes / risks:**
- No `authenticate` on this route — by design (there is no admin yet). The
  `count > 0` check is the only guard, and it is a **race**: two simultaneous
  requests can both read `count == 0` and both create a super admin. A partial
  unique index on `{ role: "super_admin" }` in MongoDB would make it safe.
- Once one super admin exists, every later call returns a clean `403`.

---

## `POST /api/auth/register` ⚠️ 500 — controller method missing

**Purpose:** a logged-in super admin creates another user (any role).

```
Client sends:  { username, email, password, role? }   + Cookie: authToken=...

Chain:  requestLogger → authenticate → authorize([SUPER_ADMIN]) → validate(registrationSchema) → controller.register

authenticate:  verify the cookie's JWT → req.user = { userId, role, ... }   (401 if missing/bad)
authorize:     req.user.role must be "super_admin"                          (403 otherwise)
validate:      username/email/password present, password ≥6, role (if given) valid

controller.register:  ✗ AuthController has no `register` method
  → TypeError inside the arrow wrapper → Express 5 forwards to errorHandler → 500 (generic)
```

**The service method exists and is correct** (`authService.register`): it checks
`findByUsername` and `findByEmail` for duplicates (`409` each), creates the user,
mints a token, returns `{ user, token }`. Only the controller adapter is
missing.

---

## `POST /api/auth/login` ⚠️ 500 — controller method missing, **and** service bug

**Purpose:** exchange username + password for an auth cookie.

```
Client sends:  { username, password }

Chain:  requestLogger → validate(loginSchema) → controller.login

controller.login:  ✗ AuthController has no `login` method → TypeError → 500
```

Even if the controller method existed, **`authService.login` has its own bug**:

```js
const isPasswordValid = await this.comparePassword(password, user.password);
```

`AuthService` has no `comparePassword` method. It was never added, and neither
was `User.comparePassword` (an open issue since Phase 2). One of the two needs to
exist — a thin wrapper over `bcrypt.compare(candidate, storedHash)`.

The rest of `authService.login` is sound: `findByUsername` → `401` if absent,
`403` if `!user.isActive`, `401` on a bad password, else mint a token and return
`{ user, token }`.

> `login` reads `user.password` — the bcrypt hash — from the document.
> `findByUsername` does a plain `findOne({ username })` and `User.password` has no
> `select: false`, so the hash *is* present and readable. If anyone later adds
> `select: false` to `User.password` (an open hardening item), `findByUsername`
> must switch to `.select("+password")` or login silently breaks.

---

## `GET /api/auth/profile` ⚠️ 500 — controller method missing

**Purpose:** return the current user's own record.

```
Client sends:  (nothing)   + Cookie: authToken=...

Chain:  requestLogger → authenticate → controller.getProfile

authenticate:  verify cookie → req.user = { userId, ... }
controller.getProfile:  ✗ no method → TypeError → 500
```

`authService.getProfile(userId)` exists and is correct: `findById(userId)` → `404`
if absent, else `formatUserForResponse(user)`. The controller would call it with
`req.user.userId` and wrap the result in a `ResponseFormatter.success` envelope.

Also note the route is `/profile` here but the `GET /` endpoint map in
`server.js` doesn't list it — cosmetic drift.

---

## `GET /api/auth/logout` ⚠️ 500 — controller method missing

**Purpose:** clear the auth cookie.

```
Chain:  requestLogger → controller.logout       ✗ no method → TypeError → 500
```

When implemented, `logout` is trivial — no service call, just
`res.clearCookie("authToken", config.cookie)` + a `200` envelope. It should also
be a **`POST`**, not a `GET` (see [2-the-router.md](2-the-router.md)).

---

## Summary table

| Endpoint | Auth required | Role | Works today? | Blocker |
|---|---|---|---|---|
| `POST /onboard-super-admin` | no | — | ✅ yes | — |
| `POST /register` | yes | super_admin | ❌ 500 | no `controller.register` |
| `POST /login` | no | — | ❌ 500 | no `controller.login` **+** no `comparePassword` |
| `GET /profile` | yes | any | ❌ 500 | no `controller.getProfile` |
| `GET /logout` | no | — | ❌ 500 | no `controller.logout`; also should be POST |

**The pattern to finish the feature:** add four small controller methods, each
~10 lines, following `onboardSuperAdmin`'s shape (read `req`, call the matching
service method, set/clear the cookie, send a `ResponseFormatter` envelope,
`catch { next(error) }`), plus a `comparePassword` helper on the service or the
`User` model.
