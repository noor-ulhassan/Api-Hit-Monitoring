# 2 · The router — `services/auth/routes/authRouter.js`

**Mental model:** a switchboard. For each incoming `VERB /path`, it plugs the
request into a specific chain of middleware, ending in one controller method.

---

**What we did.** The file was 0 bytes. It is now a real Express `Router` with
five routes.

**What it does.** Exports a `Router` object. `server.js` does
`app.use("/api/auth", authRouter)`, which means "for any URL starting
`/api/auth`, strip that prefix and let this router try to match the rest".

## The setup lines

```js
import express from "express";
import dependencies from "../Dependencies/dependencies.js";
// ... middleware + schema imports

const router = express.Router();
const { controllers } = dependencies;      // the composition root, already assembled
const authController = controllers.authController;
```

`dependencies` is the **composition root** from Phase 6 — importing it runs
`Container.init()` once, which news up the repository, hands it to the service,
hands the service to the controller. The router just reaches in and grabs the
finished `authController`. It never calls `new` itself.

## The five routes

```js
router.post("/onboard-super-admin",
  requestLogger,
  validate(onboardSuperAdminSchema),
  (req, res, next) => authController.onboardSuperAdmin(req, res, next),
);

router.post("/register",
  requestLogger,
  authenticate,
  authorize([APPLICATION_ROLES.SUPER_ADMIN]),
  validate(registrationSchema),
  (req, res, next) => authController.register(req, res, next),
);

router.post("/login",
  requestLogger, validate(loginSchema),
  (req, res, next) => authController.login(req, res, next),
);

router.get("/profile",
  requestLogger, authenticate,
  (req, res, next) => authController.getProfile(req, res, next),
);

router.get("/logout",
  requestLogger,
  (req, res, next) => authController.logout(req, res, next),
);
```

## How to read one route line

`router.post(path, mw1, mw2, ..., handler)` — Express runs `mw1`, then (if it
called `next()`) `mw2`, and so on, finally the handler. Any one of them can end
the request by sending a response and *not* calling `next()`.

| Route | Chain | In plain words |
|---|---|---|
| `POST /onboard-super-admin` | log → validate | anyone may call it (there is no admin yet to authenticate as); just check the body shape |
| `POST /register` | log → **authenticate → authorize(SUPER_ADMIN)** → validate | you must be logged in **and** a super admin to create a user |
| `POST /login` | log → validate | public; check the body then try to log in |
| `GET /profile` | log → **authenticate** | you must be logged in; any role |
| `GET /logout` | log only | public |

## Why the order is exactly this

- **`requestLogger` first** — so it times the *entire* chain, including auth and
  validation.
- **`authenticate` before `authorize`** — `authorize` reads `req.user.role`, and
  `req.user` does not exist until `authenticate` decodes the token and sets it.
- **`authorize` before `validate`** — cheap identity/role rejection before you
  bother parsing the body's shape. (Also: you don't want to leak "your body was
  malformed" details to someone who isn't even allowed on the route.)
- **`validate` last, before the handler** — the final gate; if the body is bad
  the handler never runs and no DB call happens.

## The arrow-wrapped handlers

```js
(req, res, next) => authController.onboardSuperAdmin(req, res, next)
```

**not** just `authController.onboardSuperAdmin`. The method uses
`this.authService`. If Express called the bare function reference, `this` inside
it would be `undefined` (or the router), and `this.authService` would throw. The
arrow wrapper calls the method *on* `authController`, so `this` is bound
correctly. Phase 6 flagged this as a trap; the router avoids it.

## What is wrong here (see [6-what-is-still-half-wired.md](6-what-is-still-half-wired.md))

- `authController.register`, `.login`, `.getProfile`, `.logout` **do not exist**.
  Four of the five routes throw `TypeError` inside the arrow wrapper; Express 5
  catches it and forwards to `errorHandler`, which returns a generic 500.
- `/logout` is a `GET`. Logout changes state (clears the cookie), so it should be
  `POST` — a `GET` can be triggered by a prefetch or a crawled link.
