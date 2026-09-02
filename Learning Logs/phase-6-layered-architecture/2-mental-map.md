# 2 · The mental map — diagrams

Four pictures of the `auth` slice: the folder tree, a request travelling through
it, who imports whom, and who owns what.

---

## Directory layout after this phase

```
server/src/
├─ server.js                         bootstrap — does NOT yet import services/
├─ services/                         NEW — one folder per feature
│  └─ auth/
│     ├─ Dependencies/dependencies.js  composition root: wires repo→service→controller
│     ├─ controller/authController.js  HTTP adapter
│     ├─ service/authService.js        business rules + JWT minting
│     ├─ repository/BaseRepository.js  abstract contract (methods throw)
│     ├─ repository/UserRepository.js  MongoDB impl (extends BaseRepository)
│     └─ routes/authRouter.js          EMPTY — nothing is mounted
└─ shared/
   ├─ constants/roles.js             role strings + helpers
   ├─ config/index.js                + cookie{} block
   ├─ Middleware/authenticate.js     verify JWT cookie → req.user
   ├─ Middleware/authorize.js        req.user.role vs allowed list
   └─ models/User.js                 used by UserRepository
```

## How a request will flow (once the router is wired)

```
  POST /api/auth/onboard  { username, email, password }
        │
        ▼
  [ authRouter ]  ── EMPTY; this line does not exist yet
        │  (no auth middleware — onboard is the bootstrap route)
        ▼
  AuthController.onboardSuperAdmin(req, res, next)
        │  read req.body, add role, call ONE service method
        ▼
  AuthService.onboardSuperAdmin(data)
        │  1. userRepository.findAll()      ── any users? yes → throw AppError 403
        │  2. userRepository.create(data)   ── returns a Mongoose User doc
        │  3. generateToken(user)           ── jwt.sign(payload, secret)
        │  4. formatUserForResponse(user)   ── toObject(), delete password
        ▼
  MongoUserRepository → User model (Mongoose) → MongoDB `users`
        │  (User.pre('save') hashes the password here)
        ▼
  back up: { token, user } → controller
        │  res.cookie('authToken', token, config.cookie)
        │  res.status(201).json(ResponseFormatter.success(user, ...))
        ▼
  201 + Set-Cookie: authToken=...; HttpOnly; SameSite=Strict
```

A **protected** request later (not built):

```
  GET /api/auth/me   Cookie: authToken=...
        │
        ▼
  authenticate   ── verify cookie → req.user = {userId, role, ...}   (401 if bad)
        │
        ▼
  authorize(["super_admin", "client_admin"])   ── 403 if role not in list
        │
        ▼
  AuthController.<method>  →  AuthService  →  Repository
```

## Import graph (who depends on whom)

```
dependencies.js ─┬─► controller/authController.js ─┬─► shared/constants/roles.js
                 │                                 ├─► shared/config/index.js
                 │                                 └─► shared/utils/ResponseFormatter.js
                 ├─► service/authService.js ───────┬─► shared/utils/AppError.js
                 │                                 ├─► jsonwebtoken
                 │                                 ├─► shared/config/index.js
                 │                                 └─► shared/config/logger.js
                 └─► repository/UserRepository.js ─┬─► repository/BaseRepository.js
                                                   ├─► shared/models/User.js
                                                   └─► shared/config/logger.js

shared/Middleware/authenticate.js ─► ResponseFormatter, jsonwebtoken, config
shared/Middleware/authorize.js    ─► ResponseFormatter

server.js  ─►  (nothing under services/ or the new middleware)   ◄── THE GAP
```

Every arrow points down a layer or into `shared/`. None point back up. The one
missing arrow — `server.js` → `authRouter` → `dependencies` — is why nothing
runs.

## Who owns what (single-owner table)

| Concern | Owned by | Everyone else |
|---|---|---|
| read `req.body` / write `res` / set cookie | `authController` | never touch `req`/`res` |
| "only one super admin ever" rule | `authService` | — |
| mint / sign a JWT | `authService.generateToken` | — |
| strip `password` before returning | `authService.formatUserForResponse` **and** `UserRepository.findAll` | two owners — Issue |
| talk to Mongoose / build queries | `MongoUserRepository` | no other file imports `User` for writes |
| the list of valid role strings | `shared/constants/roles.js` | `User.js` still hard-codes its own — Issue |
| verify a token, populate `req.user` | `authenticate` | — |
| enforce role on a route | `authorize(roles)` | — |
| turn a thrown error into a response | `errorHandler` (Phase 4) | but `authenticate`/`authorize` respond directly — Issue |
