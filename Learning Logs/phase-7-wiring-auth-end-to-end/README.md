# Phase 7 — Wiring auth end to end

**One line:** the auth slice that Phase 6 built but left disconnected is now
**mounted and reachable** — with a router, a validation layer, a request logger,
and a batch of long-standing bugs finally fixed.

**Commits:** `8c514c6` (validation schemas) → `268b43f` (validate middleware) →
`2fe568e` (router + service methods + server wiring)  **Dates:** 3–4 Sep 2026

**State after this phase:** `server.js` mounts `app.use("/api/auth", authRouter)`.
`POST /api/auth/onboard-super-admin` **works end to end** — you can create the
first admin and get back a user + an `httpOnly` auth cookie. The other four
routes (`/register`, `/login`, `/profile`, `/logout`) are declared and their
middleware chains run, but they hit a **missing controller method** near the end
and 500. The service layer for register/login/getProfile *is* written; the
controller methods that call it are not.

---

## What is NEW this phase vs what was already there

| Layer | Already existed (Phase 6) | NEW this phase |
|---|---|---|
| **Router** | `routes/authRouter.js` — empty file | filled: 5 routes, each with its own middleware chain |
| **Validation** | — | `shared/Middleware/validate.js` (hand-rolled validator) + `services/auth/validation/authSchema.js` (3 schemas) |
| **Request logging** | an inline logger in `server.js` (logs on arrival, no status) | `shared/Middleware/requestLogger.js` (logs on `finish`, with status + duration) |
| **Service** | `authService` — only `onboardSuperAdmin` (and it was buggy) | `+ register`, `+ login`, `+ getProfile`, `+ checkSuperAdminPermissions`; `onboardSuperAdmin` fixed |
| **Repository** | 5 methods | `+ count(filter)` on both `BaseRepository` and `UserRepository` |
| **`server.js`** | built the app, served `/` + `/health`, did NOT mount routes | `+ cookie-parser`, `cors` with credentials, `+ app.use("/api/auth", authRouter)`, removed the stray `dotenv.config()` |
| **Bug fixes** | ~15 open across Phases 1–6 | ~14 of them closed here — see [5-hardening-the-bugs-we-closed.md](5-hardening-the-bugs-we-closed.md) |

## Files this phase touched

```
server/src/
├─ server.js                              + cookieParser, cors credentials, mounts authRouter
├─ services/auth/
│  ├─ routes/authRouter.js                0 bytes → 5 routes + middleware chains
│  ├─ service/authService.js              + register / login / getProfile / checkSuperAdminPermissions
│  ├─ repository/{Base,User}Repository.js  + count(filter)
│  └─ validation/authSchema.js            NEW — onboard / registration / login schemas
├─ shared/Middleware/
│  ├─ validate.js                         NEW — validate(schema) → middleware
│  ├─ requestLogger.js                    NEW — res.on("finish") access log
│  ├─ authenticate.js                     import fixes, + logger, config.jwt.secret, named export
│  ├─ authorize.js                        empty-roles branch: `return next()`
│  └─ errorHandler.js                     err.statusCode, headersSent guard, level-aware log, no leak
├─ shared/config/index.js                 node_env "development", jwt.secret (typos fixed)
└─ shared/models/User.js                  hash-guard regex, modern async pre-save, correct import
server/package.json                       + cookie-parser
```

## Read in this order

1. **[1-request-lifecycle.md](1-request-lifecycle.md)** — ★ the whole belt: one
   request through every middleware and layer, beginner detail. **Start here.**
2. **[2-the-router.md](2-the-router.md)** — `authRouter.js`: how a route = path +
   method + a chain of middleware.
3. **[3-validation-layer.md](3-validation-layer.md)** — `validate.js` +
   `authSchema.js`: the hand-rolled validator, where it sits, its limits.
4. **[4-the-five-auth-apis.md](4-the-five-auth-apis.md)** — each endpoint walked
   end to end; which ones work today.
5. **[5-hardening-the-bugs-we-closed.md](5-hardening-the-bugs-we-closed.md)** —
   the pile of Phase 1–6 bugs fixed here, each with *why it would have bitten in
   production*.
6. **[6-what-is-still-half-wired.md](6-what-is-still-half-wired.md)** — the
   controller gap, the missing `comparePassword`, the double logger, the onboard
   race.

## The gist

- **A route is a path + a verb + an ordered list of middleware ending in a
  handler.** `authRouter.js` declares all five.
- **Middleware runs in the order you list it.** `authenticate` before
  `authorize` because `authorize` reads the `req.user` that `authenticate` sets.
- **`validate(schema)` is a gate** — it rejects malformed bodies with a 400
  *before* any DB work. It's hand-rolled (no Joi/Zod), so it only checks
  `required` / `minLength` / a `custom` function — not email format or the real
  password policy (those still only run at the Mongoose layer).
- **The auth cookie now works** because Phase 7 added `cookie-parser` (to read
  it) and `cors(..., credentials: true)` (to let the browser send it).
- **The error handler is now production-grade** — right status code, level-aware
  logging, and it never leaks a raw error message to the client.
- **Only `/onboard-super-admin` is fully wired.** The controller has one method;
  the router calls four that don't exist yet.

## Issues

~14 closed, ~8 opened — all tracked in [../OPEN-ISSUES.md](../OPEN-ISSUES.md).
The headline new one: `authController` has only `onboardSuperAdmin`, so
`/register`, `/login`, `/profile`, `/logout` throw `TypeError` and 500.
