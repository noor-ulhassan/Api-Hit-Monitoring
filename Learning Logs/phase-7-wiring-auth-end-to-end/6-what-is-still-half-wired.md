# 6 · What is still half-wired

**Mental model:** the plumbing is connected but four of the five taps have no
handle. The pipes are correct; the last inch is missing.

Full detail and status for every item is in [../OPEN-ISSUES.md](../OPEN-ISSUES.md);
this page is the Phase 7 shortlist with context.

---

## 1. The controller has one method; the router calls five

`authController.js` still contains only `onboardSuperAdmin`. `authRouter.js`
references `authController.register`, `.login`, `.getProfile`, `.logout`.

**Effect:** the arrow wrapper `(req,res,next) => authController.register(...)`
throws `TypeError: authController.register is not a function` synchronously.
Express 5 catches it and forwards to `errorHandler`, which — correctly — treats a
bare `TypeError` as non-operational and returns a generic **500**. So four routes
are reachable but unusable.

**Fix:** add four ~10-line methods mirroring `onboardSuperAdmin` — read `req`,
call the matching (already-written) `authService` method, set or clear the
cookie, send a `ResponseFormatter` envelope, `catch { next(error) }`.

## 2. `authService.login` calls `this.comparePassword` — which doesn't exist

```js
const isPasswordValid = await this.comparePassword(password, user.password);
```

Neither `AuthService.comparePassword` nor `User.comparePassword` exists (the
latter has been an open item since Phase 2). Login would `TypeError` even with a
controller method.

**Fix:** one of —
- `AuthService.comparePassword(plain, hash) { return bcrypt.compare(plain, hash); }`, or
- `userSchema.methods.comparePassword = function (plain) { return bcrypt.compare(plain, this.password); }`
  and call `user.comparePassword(password)`.

## 3. Two request loggers

`server.js` still has its original inline logger (logs on **arrival**, no status,
every route). The router now also attaches `requestLogger` (logs on **finish**,
with status + duration, auth routes only). An auth request produces **two log
lines in two formats**.

**Fix:** delete the inline one from `server.js` and either move `requestLogger`
to an app-level `app.use` (so it covers every route) or leave it per-route.

## 4. `onboard-super-admin` has a race

No `authenticate` (correct — no admin exists yet), guarded only by
`count({ role: "super_admin" }) > 0`. Two requests arriving together can both see
`count == 0` and both create a super admin.

**Fix:** a MongoDB partial unique index —
`{ role: 1 }, { unique: true, partialFilterExpression: { role: "super_admin" } }`
— so the second `save()` fails with a duplicate-key error (which `errorHandler`
already maps to `409`).

## 5. Validation is split and inconsistent

`validate(schema)` checks `required` / `minLength: 6` / a `custom` function.
It does **not** check email format or the real password policy (uppercase,
number, symbol, min 8) — those run only inside `user.save()`. A weak password
passes the door and fails two layers deeper as a Mongoose `ValidationError`.
See [3-validation-layer.md](3-validation-layer.md).

**Fix:** call `SecurityUtils.validatePassword` from `validate` for password
fields; add an email-format rule.

## 6. `checkSuperAdminPermissions` swallows errors

```js
async checkSuperAdminPermissions(userId) {
  try { ... return user.role === SUPER_ADMIN; }
  catch (error) {}                      // ← empty; returns undefined
}
```

If `findById` throws, the caller gets `undefined` (falsy) and cannot distinguish
"not a super admin" from "the database is down". Not called anywhere yet.

**Fix:** `catch (error) { logger.error(...); throw error; }` and let the caller
decide.

## 7. `GET /logout` should be `POST`

Clearing the auth cookie is a state change. A `GET` can be fired by a browser
prefetch, a crawled `<a href>`, or an `<img src>` — any of which would silently
log the user out. Use `POST`.

## 8. `cors({ origin: true })` is still wide open

`credentials: true` was fixed; `origin: true` (reflect any origin) is still the
permissive setting. For production, pin it to the dashboard's real URL, read from
`config`.

## 9. Smaller carry-overs

- `parseInt(process.env.PORT || 8080)` — still missing the radix `10` argument.
- `ApiKey.js` still imports `"../utils/SecurityUtils.js"` (wrong name); latent —
  nothing imports `ApiKey`.
- `authenticate` / `authorize` still format their own error responses inline
  instead of `next(new AppError(...))` — two error styles in the codebase.
- The auth cookie is `sameSite: "strict"`, which means it is **not sent on a
  top-level navigation from another site** — fine for an SPA calling an API, but
  worth knowing if a redirect-based flow is ever added.
