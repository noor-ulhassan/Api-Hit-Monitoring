# 5 · Controller, DI container, and the small supporting files

**Mental model:** the controller is a translator (HTTP ↔ service). The container
is the electrician (wires the boxes together). `roles.js` and the `cookie`
config are the labelled parts they use.

---

## `controller/authController.js`

**What we did.** `AuthController` class. Constructor takes `authService`, throws
if absent. One method, `onboardSuperAdmin(req, res, next)`:

- destructure `username, email, password` from `req.body`;
- build `superAdminData` with `role: APPLICATION_ROLES.SUPER_ADMIN`;
- `const { token, user } = await this.authService.onboardSuperAdmin(...)`;
- `res.cookie("authToken", token, { ...config.cookie })`;
- `res.status(201).json(ResponseFormatter.success(user, "Super Admin Onboarded
  Successfully", 201))`;
- `catch (error) { next(error) }` — hand off to the central error middleware.

**What it does.** Adapts one HTTP request to one service call and back. The only
logic is "the role for this endpoint is super_admin".

**Why.** Keep HTTP concerns (body parsing, status codes, cookies, envelopes) out
of the service, and keep the service call to one line so the flow is obvious.

**Wiring.** Imports `roles`, `config`, `ResponseFormatter`. Constructed by the
container with the service. Its methods are *meant* to be route handlers — so
whoever fills `authRouter.js` must preserve `this` (`.bind`, or an arrow
wrapper), or `this.authService` is `undefined` at call time (Issue).

---

## `Dependencies/dependencies.js`

**What we did.** A `Container` class with one static `init()` that builds three
plain objects — `repositories`, `services`, `controllers` — wiring each layer to
the one below. At module load, `const initialized = Container.init()` runs; the
module exports `{ Container }` (named) and `initialized` (default).

```
userRepository  = MongoUserRepository            (already an instance)
authService     = new AuthService(userRepository)
authController  = new AuthController(authService)
```

**What it does.** It is the **composition root**: the only file that calls `new
AuthService(...)` / `new AuthController(...)` and decides `userRepository` is the
Mongo one. Import the default export anywhere and you get
`{ repositories, services, controllers }` fully assembled.

**Why.** Centralising construction is what makes DI worthwhile — tests build
their own container with fakes; production swaps an implementation in one line;
classes stay ignorant of who supplies their dependencies.

**Wiring.** Imports the controller, the service, the `MongoUserRepository`
instance. *Meant* to be imported by `routes/authRouter.js`. Currently imported by
**nothing**.

---

## `shared/constants/roles.js`

**What we did.** `ROLES` (all three strings), `CLIENT_ROLES` (the two
tenant-scoped), `APPLICATION_ROLES` (object map, `SUPER_ADMIN: "super_admin"`),
plus `isValidRole` / `isValidClientRole`.

**Why.** A symbol beats a bare string: a typo in `APPLICATION_ROLES.SUPER_ADMN`
is a crash; a typo in `"super_admn"` is a silent auth hole. Previously the role
strings lived only in the `User.js` `enum`.

**Wiring.** Imported by `authController.js`. **Not yet** imported by `User.js`
(still has its own literal `enum`) or `UserRepository.create` (literal
`"super_admin"`) — three copies, Issue.

---

## `shared/config/index.js` — the `cookie` block

```
cookie: {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",   // dev over HTTP still works
  maxAge: 24 * 60 * 60 * 1000,                     // matches the JWT's 24h expiry
  sameSite: "strict",                              // CSRF defence
}
```

Central settings for the auth cookie the controller sets. `secure` reads
`process.env.NODE_ENV` directly — correct, it dodges the `node_env: "Development
"` typo a few lines up. Read by `authController.js`.

---

## `routes/authRouter.js`

**Empty (0 bytes).** The placeholder for the Express `Router` that will map
`POST /onboard` (and later `/login`, `/logout`, `/me`) to
`container.controllers.authController.*`, attach `authenticate` / `authorize`,
and that `server.js` will `app.use("/api/auth", authRouter)`.

**This empty file is the exact reason the phase's work is inert.** Every other
file is downstream of a router that does not exist.
