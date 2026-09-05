# 1 · The request lifecycle — one HTTP call, start to finish

**Mental model:** an HTTP request is a parcel on a conveyor belt. It passes a row
of stations (middleware), each of which can stamp it, redirect it, or reject it.
If it survives the row, it reaches the **controller**, which unpacks it, sends
the real work to a **service**, and packs a reply. The reply then rides the belt
back out.

This page traces one request through **every station**, in order, with
beginner-level detail. Read it once and you can follow any route in the app.

---

## The example: creating the very first admin

```
POST http://localhost:8080/api/auth/onboard-super-admin
Content-Type: application/json

{ "username": "noor", "email": "noor@x.com", "password": "Str0ng!pass" }
```

This is the one route that is fully working today. The other four
(`/register`, `/login`, `/profile`, `/logout`) follow the same belt but hit a
missing controller method near the end — see
[6-what-is-still-half-wired.md](6-what-is-still-half-wired.md).

---

## The whole belt, at a glance

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │ 1. TCP + HTTP     Node's http server parses the raw bytes into a    │
   │                   `req` object and an empty `res` object            │
   └───────────────────────────────┬─────────────────────────────────────┘
                                   ▼
   ── APP-LEVEL MIDDLEWARE (server.js — runs for EVERY request) ─────────
   2. cookieParser()      reads the `Cookie:` header → fills `req.cookies`
   3. helmet()            sets ~12 security response headers
   4. cors({...})         sets Access-Control-Allow-* headers
   5. express.json()      reads the JSON body → fills `req.body`
   6. express.urlencoded  (same, for form-encoded bodies)
   7. inline logger       writes one "GET /path" line to Winston (on arrival)
                                   ▼
   ── ROUTE MATCHING (Express looks for a handler for POST /api/auth/...) 
   8. app.use("/api/auth", authRouter)   → strip "/api/auth", hand to the router
   9. authRouter matches  POST "/onboard-super-admin"
                                   ▼
   ── ROUTE-LEVEL MIDDLEWARE (authRouter.js — only for THIS route) ──────
   10. requestLogger      starts a timer, registers an on-finish callback
   11. validate(onboardSuperAdminSchema)   checks req.body shape → 400 if bad
                                   ▼
   ── THE ROUTE HANDLER ───────────────────────────────────────────────
   12. (req,res,next) => authController.onboardSuperAdmin(req,res,next)
                                   ▼
   ── THE LAYERS ──────────────────────────────────────────────────────
   13. AuthController.onboardSuperAdmin   read req.body, add role, call service
   14. AuthService.onboardSuperAdmin      the RULE: only one super admin ever
        ├─ userRepository.count({ role })        → MongoDB: countDocuments
        ├─ userRepository.create(data)           → new User(...).save()
        │     └─ User.pre('save')  bcrypt-hashes the password
        ├─ generateToken(user)                   → jwt.sign(payload, secret)
        └─ formatUserForResponse(user)           → drop the password field
                                   ▼
   ── THE REPLY, BACK UP THE BELT ─────────────────────────────────────
   15. controller: res.cookie("authToken", token, config.cookie)
   16. controller: res.status(201).json(ResponseFormatter.success(user, ...))
   17. Express serialises the object, sends the HTTP response
   18. `res` emits "finish"  →  requestLogger's callback logs status + duration
                                   ▼
                             client gets:
             201 Created
             Set-Cookie: authToken=eyJ...; HttpOnly; SameSite=Strict; Max-Age=86400
             { "success": true, "data": { ...user, no password }, "message": "...",
               "statusCode": 201, "timestamp": "..." }
```

---

## Station by station

### 1. The raw request becomes `req` / `res`

Node's built-in HTTP server reads the bytes off the socket and builds two
objects: `req` (method, url, headers, and a readable stream for the body) and
`res` (a writable stream you call `.status()` / `.json()` / `.end()` on).
Express wraps both with extra helpers. **Nothing in our code runs yet** — this is
Node + Express plumbing.

### 2. `cookieParser()` — *new this phase*

The browser sends cookies as one header: `Cookie: authToken=eyJ...; theme=dark`.
That is a raw string. `cookie-parser` splits it into an object and attaches it as
`req.cookies` → `{ authToken: "eyJ...", theme: "dark" }`. Without this line,
`req.cookies` is `undefined` and `authenticate` can never find the token. (This
was Phase 6's biggest gap — the middleware that *reads* the cookie existed, but
nothing *parsed* it.)

It is registered **first** so every later station can see `req.cookies`.

### 3. `helmet()`

One function call that sets a bundle of defensive HTTP **response** headers:
`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, a `Content-Security-Policy`, and more. These tell the
*browser* to behave safely with our response (don't guess content types, don't
let other sites frame us, only talk HTTPS). Cheap, high-value, set once.

### 4. `cors({ origin: true, credentials: true })` — *changed this phase*

**CORS** (Cross-Origin Resource Sharing) is a browser rule: JavaScript on
`https://dashboard.example.com` may not read a response from
`http://localhost:8080` **unless** the response carries
`Access-Control-Allow-Origin` naming that origin. The `cors` middleware writes
those headers.

- `origin: true` — reflect whatever `Origin` the request carried, i.e. "allow
  any site". Fine for local dev; **must be pinned to the real dashboard URL
  before production** (still an open issue).
- `credentials: true` — add `Access-Control-Allow-Credentials: true`, which is
  what lets the browser **send and store our `authToken` cookie** on
  cross-origin calls. Without it the login cookie would be dropped by the
  browser. (Phase 6 used bare `cors()` with no credentials — the cookie flow
  could not have worked.)

### 5–6. `express.json()` / `express.urlencoded()`

The body arrived as a stream of bytes. `express.json()` reads the whole stream,
and if `Content-Type: application/json`, parses it and sets `req.body` to the
resulting object. `express.urlencoded()` does the same for HTML-form posts.
**Before these run, `req.body` is `undefined`** — which is why body parsers must
come before any route that reads the body.

### 7. The inline logger (app-level)

`server.js` has a small middleware that writes `POST /api/auth/onboard-super-admin`
plus `ip` and `user-agent` to Winston, then `next()`. It logs on **arrival**, so
it never knows the status code or how long the request took.

> Note: this phase also added a *better* logger, `requestLogger.js` (station 10),
> which logs on **completion** with status + duration. The router attaches it
> per-route, so auth requests currently get logged **twice** — once here, once
> there. The inline one should be removed now. See
> [6-what-is-still-half-wired.md](6-what-is-still-half-wired.md).

### 8–9. Route matching

Express walks its stack in registration order. It reaches
`app.use("/api/auth", authRouter)`. The path prefix matches, so Express strips
`/api/auth` and hands the request to `authRouter` with `req.url` now
`/onboard-super-admin`. The router then finds the `router.post("/onboard-super-admin", ...)`
entry. If **no** route matched anywhere, the request falls through to the 404
middleware at the bottom of `server.js`.

### 10. `requestLogger` (route-level) — *new this phase*

```js
const start = Date.now();
res.on("finish", () => { /* log method, url, ip, status, duration */ });
next();
```

It does almost nothing *now* — it records the start time and registers a
callback. The callback fires much later (station 18), when the response has
actually been written. This is the correct way to build an access log: you only
know the status code and total time **after** the response is done.

### 11. `validate(onboardSuperAdminSchema)` — *new this phase*

`validate` is a **factory**: called with a schema, it returns a middleware. The
schema is a plain object:

```js
{ username: { required: true },
  email:    { required: true },
  password: { required: true, minLength: 6 } }
```

The middleware loops over each field, checks `req.body` against the rules,
collects every failure into an `errors` array, and:

- if `errors.length` → **stop here**, send
  `400 { success:false, error:[...], message:"Validation failed" }`;
- else → `next()`.

This is the **request gate**: it rejects obviously-malformed input *before* any
database work. (Its limits — no email-format check, no real password policy — are
covered in [3-validation-layer.md](3-validation-layer.md).)

### On protected routes, two more stations run here

For `/register` and `/profile` the chain also includes:

- **`authenticate`** — reads `req.cookies.authToken`, runs
  `jwt.verify(token, config.jwt.secret)`. If the signature is valid and the
  token is not expired, it decodes the payload and sets
  `req.user = { userId, email, username, role, clientId }`, then `next()`.
  Otherwise it sends `401` and the belt stops. **This is how a stateless token
  replaces a database session lookup** — the user's identity travels *inside*
  the signed token.
- **`authorize([SUPER_ADMIN])`** — a factory returning a middleware. It reads
  `req.user.role` (put there by `authenticate`) and checks it against the
  allowed list. Not in the list → `403`. In the list → `next()`.

Order matters: `authenticate` must run before `authorize`, because `authorize`
reads `req.user`, which `authenticate` creates.

### 12. The route handler

```js
(req, res, next) => authController.onboardSuperAdmin(req, res, next)
```

Why the arrow wrapper instead of passing `authController.onboardSuperAdmin`
directly? Because the method body uses `this.authService`. If Express called the
bare function, `this` would be `undefined` and `this.authService` would crash.
Wrapping it in an arrow that calls `authController.onboardSuperAdmin(...)` keeps
`this` bound to `authController`. (Phase 6 flagged this trap; the router does it
right.)

### 13. `AuthController.onboardSuperAdmin` — the HTTP adapter

```js
const { username, email, password } = req.body;         // read HTTP
const superAdminData = { username, email, password, role: SUPER_ADMIN };
const { token, user } = await this.authService.onboardSuperAdmin(superAdminData); // delegate
res.cookie("authToken", token, config.cookie);          // write HTTP
res.status(201).json(ResponseFormatter.success(user, "...", 201));
// on any throw:  next(error)  → the error middleware
```

Everything the controller does is *translation*: pull fields out of `req`, decide
the one route-specific fact ("this endpoint's role is super_admin"), call **one**
service method, and turn the result into a cookie + a JSON envelope. **No
database call, no rule.** If the service throws, `catch { next(error) }` hands
the error to the central `errorHandler` — the controller never formats an error
itself.

### 14. `AuthService.onboardSuperAdmin` — the rule

```js
const superAdminCount = await this.userRepository.count({ role: SUPER_ADMIN });
if (superAdminCount > 0) throw new AppError("Super Admin already exists", 403);
const user  = await this.userRepository.create(superAdminData);
const token = this.generateToken(user);
return { token, user: this.formatUserForResponse(user) };
```

The service holds the **decision**: *the system may have exactly one super
admin.* It asks the repository to count existing super admins; if there is one
already, it throws a `403` `AppError` (which the controller's `catch` will pass
to `errorHandler`, which will send a clean `403` because `AppError` sets
`statusCode` and `isOperational`). Otherwise it creates the user, mints a JWT,
and returns a **plain result** — `{ token, user }`. It never touches `req` or
`res`. That is what makes it reusable: a command-line seed script could call this
exact method.

`generateToken(user)` builds a payload `{ userId: _id, email, username, role,
clientId }` and signs it: `jwt.sign(payload, config.jwt.secret, { expiresIn:
"24h" })`. The result is the `eyJ...` string that becomes the cookie.

`formatUserForResponse(user)` turns the Mongoose document into a plain object and
`delete`s `password`, so the hash never leaves the server.

### 14a. `MongoUserRepository` — the only door to the database

```js
async count(filter)  { return this.model.countDocuments(filter); }
async create(data)   { const u = new this.model(data); await u.save(); return u; }
```

`this.model` is the Mongoose `User` model. `.countDocuments({ role: "super_admin" })`
becomes a MongoDB `count` query. `new User(data)` + `.save()` runs schema
validation, then `User.pre('save')` (which bcrypt-hashes `this.password` with a
cost-10 salt), then the actual insert into the `users` collection. The service
asked "create a user"; *how* that becomes Mongoose calls is the repository's
private business — swap this class for a `PostgresUserRepository` and nothing
above changes.

### 15–17. The reply rides back out

Control returns up the stack: repository → service → controller. The controller
sets the cookie header (`Set-Cookie: authToken=...; HttpOnly; SameSite=Strict;
Max-Age=86400`) and calls
`res.status(201).json(ResponseFormatter.success(user, "...", 201))`.
`ResponseFormatter.success` builds the standard envelope
`{ success:true, data, message, statusCode, timestamp }`; `res.json` serialises
it to a string, sets `Content-Type: application/json`, and writes the HTTP
response.

### 18. `res` emits `"finish"`

Now that the response is fully written, Node fires the `finish` event on `res`.
The callback `requestLogger` registered back at station 10 runs:

```
HTTP POST /api/auth/onboard-super-admin 127.0.0.1 43ms   { status: 201, duration: 43 }
```

This is the access-log line an ops team actually wants — method, path, status,
and latency, one per completed request.

---

## The error path (any station can take it)

If `authenticate` fails, or `validate` fails, or the service throws, the belt
does **not** reach the controller's success line. Two shapes of "stop":

1. **A middleware sends its own response and stops.** `validate` on bad input,
   `authenticate` on a bad token, `authorize` on a wrong role — each calls
   `res.status(4xx).json(ResponseFormatter.error(...))` and simply does not call
   `next()`. The belt halts; nothing downstream runs.
2. **The controller catches a thrown error and forwards it.**
   `catch (error) { next(error) }`. Calling `next` *with an argument* tells
   Express "skip every normal middleware, jump straight to the error handler".
   `errorHandler` (the 4-arg middleware at the very bottom of `server.js`) then:
   - reads `err.statusCode` (or 500), `err.message`, `err.errors`;
   - re-maps known framework errors (Mongoose `ValidationError` → 400, duplicate
     key → 409, JWT errors → 401);
   - logs at `error` level for 5xx, `warn` for 4xx;
   - **hides the message for unexpected 5xx** (`err.isOperational !== true` →
     `"Internal server error"`), so a raw `TypeError` never leaks its text to the
     client;
   - sends `ResponseFormatter.error(message, statusCode, errors)`.

The two styles are inconsistent (middleware format their own errors; controllers
delegate) — noted in [6-what-is-still-half-wired.md](6-what-is-still-half-wired.md).

---

## Why this structure is "production-ready" and a single `app.post` is not

A beginner tutorial would write the whole thing as:

```js
app.post("/onboard", async (req, res) => {
  const exists = await User.countDocuments({ role: "super_admin" });
  if (exists) return res.status(403).json({ error: "exists" });
  const salt = await bcrypt.genSalt(10);
  const user = await User.create({ ...req.body, password: await bcrypt.hash(req.body.password, salt) });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
  res.json({ user, token });   // ← leaks the password hash
});
```

It works on day one. It rots by month three:

| Concern | One-`app.post` version | This app |
|---|---|---|
| body is malformed | crashes deep in the handler | `validate` rejects it at the gate with a clear 400 |
| an error is thrown | each handler `try/catch`es (or forgets to) | one `errorHandler`, consistent shape, no leaks |
| the response shape | every route invents its own | one `ResponseFormatter` envelope everywhere |
| swap MongoDB later | rewrite every handler | rewrite one repository class |
| unit-test the "one admin" rule | need a running server + DB | call `authService.onboardSuperAdmin` with a fake repo |
| where does auth live | copied into every handler | two middleware, attached per-route |
| access logs | `console.log` if you remember | `requestLogger`, status + duration, one line per request |
| the password hash leaks | easy to miss | `formatUserForResponse` strips it in one place |

Every station on the belt is a concern that would otherwise be smeared across
every route. That is the whole point of the layering.
