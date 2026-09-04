# 5 · Hardening — the bugs we closed, and why each mattered

**Mental model:** none of these were cosmetic. Each one is a thing that *works on
your laptop* and then fails — quietly or loudly — the day it meets real traffic,
a second developer, or a production environment. This is what "production-ready"
buys you: not features, but the absence of these.

Every item was an open issue since Phases 1–6. This phase closed ~14 of them.

---

## Config — `shared/config/index.js`

**`jwt.sercet` → `jwt.secret`** *(open since Phase 1)*
The key was misspelled, so `config.jwt.secret` was `undefined` and only
`config.jwt.sercet` held the value. By Phase 6 *three* files read the typo. If
anyone had "fixed" only the config, JWT signing and verifying would use different
keys and **every login would fail with an invalid-signature error** that looks
like a security bug. Now spelled correctly in the config and all readers.

**`node_env: "Development "` → `"development"`** *(open since Phase 1)*
Capital D, trailing space. `=== "production"` still worked, but any
`=== "development"` branch was **silently dead code** — the exact bugs that only
show up when you flip `NODE_ENV` in production and a "dev-only" guard doesn't
fire (or a prod-only one does).

---

## Startup — `server.js`

**Removed the second `dotenv.config()`** *(open since Phase 1)*
`server.js` called it *after* every `import` had already run — so it could not
help any module that reads `process.env` at import time. `config/index.js` calls
it correctly (before the config object is built). The `server.js` call was dead
weight and a red herring; it's gone.

---

## The error handler — `shared/Middleware/errorHandler.js`

**`req.statusCode` → `err.statusCode`** *(open since Phase 4)*
The handler read the status code off the **request** object, which has no such
property — so it was always `undefined`, always fell back to `500`. **Every
`AppError` — a `403` "already exists", a `404` "not found", a `409` "duplicate" —
was reported to the client as `500`.** The client (and your monitoring) could not
tell a user mistake from a server crash. Now reads `err.statusCode`, so an
`AppError("...", 403)` actually returns `403`.

**Level-aware logging** *(open since Phase 4)*
It logged *everything* — including 404s and validation failures — at `error`
level. In production your alerting fires on `error` logs; drowning them in
routine 4xx noise means you miss the real 500. Now: `statusCode >= 500` →
`logger.error`, otherwise `logger.warn`.

**Stop leaking internal messages** *(open since Phase 4)*
For an unexpected error (a raw `TypeError`, a null deref), the handler used to
send `err.message` straight to the client — which can expose file paths,
variable names, query fragments. Now: if `statusCode >= 500` **and**
`err.isOperational !== true` (i.e. it is *not* one of our deliberate
`AppError`s), the message is replaced with a flat `"Internal server error"` and
`errors` is nulled. Deliberate `AppError`s still show their real message,
because those are safe.

**`res.headersSent` guard** *(new)*
If some earlier middleware already sent a response and *then* an error is thrown,
trying to send a second response throws `ERR_HTTP_HEADERS_SENT` and crashes the
request. The handler now checks `res.headersSent` first and, if true, hands the
error to Express's built-in finaliser instead of trying to respond again.

---

## Auth middleware

**`authenticate.js` import missing `.js`** *(open since Phase 6)*
`import ResponseFormatter from "../utils/ResponseFormatter"` — no extension.
Node's ESM loader (`"type": "module"`) does **not** guess extensions, so this
threw `ERR_MODULE_NOT_FOUND` the instant the file was loaded. It hadn't
surfaced because nothing imported `authenticate` yet. This phase imports it (the
router does), so it *had* to be fixed. Now `"../utils/ResponseFormatter.js"`.

**`authenticate.js` used `logger` without importing it** *(open since Phase 6)*
The `catch` block called `logger.error(...)`. With no `import logger`, a token
failure would have thrown `ReferenceError` instead of returning a clean `401`.
Now imported.

**`authorize([])` double-response** *(open since Phase 6)*
`if (allowedRoles.length === 0) { next(); }` — no `return`. Execution fell
through to the "role not in list" check, which (because `[].includes(x)` is
always `false`) *also* sent a `403`. So `authorize([])` — meaning "any logged-in
user" — called `next()` **and** sent a `403`, producing
`ERR_HTTP_HEADERS_SENT`. One word fixed it: `return next()`.

---

## The service — `authService.js`

**`generateToken()` called with no argument** *(open since Phase 6)*
`onboardSuperAdmin` did `const token = this.generateToken();`, but
`generateToken(user)` destructures `user` on line 1. `undefined` → `TypeError`.
**The onboard flow could not succeed at all.** Now `this.generateToken(user)`.

**"any user exists" → "a super admin exists"** *(open since Phase 6)*
The old guard called `findAll()` and refused if *any* active user existed — so
on a system with a `client_viewer` but no admin, you could never onboard. Now
`userRepository.count({ role: "super_admin" })` — the check matches its own
error message.

---

## The model — `shared/models/User.js`

**Hash-guard regex** *(open since Phase 2)*
The guard `!password.startsWith("$2a$")` was meant to skip re-validating an
already-hashed value. But `bcryptjs@3` emits `$2b$`, so the guard **missed every
hash it produced**. Replaced with `/^\$2[aby]\$/`, which matches `$2a$`, `$2b$`,
and `$2y$`.

**Modern async `pre('save')` hook**
Rewritten from the callback style (`function (next) { ... next() ... next(err) }`)
to the promise style (`async function () { ... }` — errors propagate by
throwing). This is the Mongoose 7+ idiom; the old `next`-based form is
deprecated and easy to get subtly wrong (forget one `next()` and the save hangs
forever).

**`SecurityUtils.js` → `SecurityUtil.js`** *(open since Phase 2)*
The import pointed at a filename with a trailing "s" that doesn't exist on disk.
Fixed for `User.js`. (`ApiKey.js` still has the wrong path, but nothing imports
`ApiKey` yet.)

---

## Dependencies

**`cookie-parser` added** *(open since Phase 6)*
`authenticate` reads `req.cookies.authToken`, but nothing populated
`req.cookies`. Added `cookie-parser` to `package.json` and
`app.use(cookieParser())` as the first middleware. **The entire cookie-based
auth scheme was inert without this one line.**

**`cors` credentials** *(partial fix of a Phase 4 issue)*
`cors()` → `cors({ origin: true, credentials: true })`. `credentials: true` is
what lets the browser actually store and send our `authToken` cookie on
cross-origin calls. (The `origin: true` "allow any site" part is still too open
for production — that issue stays open.)

---

## What this adds up to

Before this phase, if you had mounted the router, a single request would have
died at: the missing `.js` import → or the `ReferenceError` in `authenticate` →
or `generateToken()` → or the `403`-reported-as-`500` → or the missing
`cookie-parser`. **Five separate walls, each fatal.** Clearing them is not
polish; it is the difference between "compiles" and "serves a request".
