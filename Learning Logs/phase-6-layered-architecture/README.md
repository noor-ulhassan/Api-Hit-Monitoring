# Phase 6 — Layered architecture and the auth slice

**One line:** the project stops being "scripts in folders" and commits to an
architecture — Repository → Service → Controller → DI — on the first feature,
`auth`.

**Commit:** `c01bff2`  **Date:** 2 Sep 2026

**State after this phase:** a complete four-layer skeleton for `auth` exists on
disk. **None of it is reachable** — `routes/authRouter.js` is empty, `server.js`
imports nothing under `services/`, no `/api/auth` route is mounted. Several
wiring bugs would stop it even if it were mounted.

---

## Files this phase touched

```
server/src/
├─ shared/constants/roles.js              NEW — canonical role strings + helpers
├─ shared/config/index.js                 + cookie{} block
├─ shared/Middleware/authenticate.js      NEW — verify JWT cookie → req.user
├─ shared/Middleware/authorize.js         NEW — req.user.role vs allowed list
└─ services/                              NEW top-level dir — one folder per feature
   └─ auth/
      ├─ repository/BaseRepository.js     abstract contract (methods throw)
      ├─ repository/UserRepository.js     the MongoDB implementation
      ├─ service/authService.js           the "one super admin" rule + JWT
      ├─ controller/authController.js     HTTP adapter
      ├─ Dependencies/dependencies.js     composition root — wires repo→svc→ctrl
      └─ routes/authRouter.js             EMPTY — the reason nothing runs
```

## Read in this order

1. **[1-the-four-layers.md](1-the-four-layers.md)** — the pattern and its one
   rule; repository, service, controller, DI, feature-first, HOF middleware,
   authN vs authZ.
2. **[2-mental-map.md](2-mental-map.md)** — the diagrams: directory tree, request
   flow, import graph, single-owner table.
3. **[3-repository-layer.md](3-repository-layer.md)** — `BaseRepository` +
   `UserRepository`.
4. **[4-service-layer.md](4-service-layer.md)** — `authService`.
5. **[5-controller-and-di.md](5-controller-and-di.md)** — `authController`,
   `dependencies.js`, `roles.js`, the `cookie` config, the empty router.
6. **[6-auth-middleware.md](6-auth-middleware.md)** — `authenticate` +
   `authorize`.

## The gist

- **Four layers, one rule:** a layer calls **down**, never up, never sideways.
  Controller doesn't query; service doesn't touch `req`/`res`; repository doesn't
  know what a JWT is.
- **Repository = the seam.** The service is handed "a thing with `findAll` and
  `create`". Today it's MongoDB; a test passes a fake; neither imports Mongoose.
- **Service = the decisions.** `onboardSuperAdmin` is the whole feature: check
  for existing users → create → mint token → return. No HTTP in it.
- **Controller = the adapter.** Read `req.body` → one service call → cookie +
  envelope → done.
- **`dependencies.js` = the composition root.** The only file that calls `new
  AuthService(...)` and decides "userRepository = the Mongo one". Swap one line,
  swap the database.
- **Feature-first folders.** `services/auth/{controller,service,repository,...}`;
  adding `client` means adding `services/client/` with the same shape.
- **`authenticate` (who are you → `req.user`) then `authorize(roles)` (are you
  allowed)** — a stateless JWT in an `httpOnly` cookie.

## Issues opened here

15 items — see [../OPEN-ISSUES.md](../OPEN-ISSUES.md). The fatal ones:
`generateToken()` called with no argument (destructures `undefined`);
`authenticate.js` import missing `.js` + uses an unimported `logger`; no
`cookie-parser` so `req.cookies` is always `undefined`; `authorize([])` falls
through and double-responds; the `jwt.sercet` typo is now load-bearing in three
files; **nothing is mounted**.
