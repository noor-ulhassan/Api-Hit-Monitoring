# 6 · Auth middleware — `authenticate.js` and `authorize.js`

**Mental model:** two gates in front of a protected route. The first asks for ID
and stamps `req.user`. The second checks the stamp against a guest list. Neither
is attached to any route yet.

---

## `shared/Middleware/authenticate.js` — "who are you"

**What we did.** An async `(req, res, next)`:

- read `token` from `req.cookies.authToken` (guarded `req.cookies && ...`);
- no token → `401` `ResponseFormatter.error("Auth Token is Required")`;
- `jwt.verify(token, config.jwt.sercet)` → attach
  `req.user = { userId, email, username, role, clientId }` from the payload →
  `next()`;
- `catch`: `TokenExpiredError` → 401 "Token Expired"; `JsonWebTokenError` → 401
  "Invalid Token"; else 401 with `error.message`.

**What it does (intended).** Turns a signed cookie into a trusted `req.user` that
downstream handlers rely on without a database lookup.

**Why a cookie, not a header.** Set `httpOnly`, the token is unreadable by page
JS, so an XSS bug can't exfiltrate it the way it could a `localStorage` token.

**Wiring.** Imports `ResponseFormatter`, `jsonwebtoken`, `config`. *Meant* to be
attached in `authRouter.js` before protected controller methods. Attached
nowhere.

**Bugs (see [../OPEN-ISSUES.md](../OPEN-ISSUES.md)):**

- import is `"../utils/ResponseFormatter"` — **missing `.js`**, fatal under ESM;
- `logger` is used in the catch but **never imported** — a verify failure throws
  `ReferenceError` instead of returning 401;
- `req.cookies` is always `undefined` — **`cookie-parser` is not a dependency and
  not mounted** in `server.js`, so every authenticated request 401s. The
  controller can *set* a cookie (`res.cookie` is built into Express); nothing can
  *read* it back.

---

## `shared/Middleware/authorize.js` — "are you allowed"

**What we did.** A factory: `authorize(allowedRoles = [])` returns
`(req, res, next) => { ... }` that:

- 403 if `!req.user || !req.user.role`;
- if `allowedRoles` is empty, `next()` (meant: "any authenticated user");
- if `req.user.role` is not in `allowedRoles`, 403 "Insufficient permissions";
- else `next()`.

**What it does (intended).** One reusable role gate, configured per route:
`authorize([APPLICATION_ROLES.SUPER_ADMIN])`.

**Why a factory.** So the same check serves every route with a different role
list, decided where the route is defined.

**Wiring.** Imports `ResponseFormatter` (correctly, with `.js`). Depends on
`authenticate` having run first to populate `req.user`. Attached nowhere.

**Bug.** The empty-list branch calls `next()` **without `return`**, so execution
falls through — and `[].includes(x)` is always `false`, so it *also* sends a
403. `authorize([])` double-responds ("Cannot set headers after they are sent").

---

## Both middlewares share one design smell

They build `ResponseFormatter.error(...)` and `res.status().json()` **inline**,
while controllers use `next(error)` and let `errorHandler` format. Two error
styles in one codebase. Prefer `next(new AppError("...", 401))` so there is one
formatter — and one place to add logging / `isOperational` handling later.
