# THE WIRING — how every file actually connects

You wrote `models/`, `utils/`, `Middleware/`, and inside `services/auth/`:
`repository/`, `service/`, `controller/`, `Dependencies/`, `routes/`,
`validation/`. Each file makes sense alone. What's missing is the **glue**: when
does one file actually reach another, and in what order does any of this
happen?

This page answers that directly. Three ideas carry the whole picture:

1. **Import** — file A puts `import X from "./x.js"` at the top. This is
   *static*: it happens once, when Node loads the file, long before any HTTP
   request.
2. **Construction (dependency injection)** — one file, `Dependencies/dependencies.js`,
   explicitly does `new AuthService(userRepository)`. This is *not* an import
   relationship — `AuthService.js` never imports `UserRepository.js`. The
   container hands the finished repository to the service's constructor.
3. **Method call at request time** — `controller.method()` calls
   `service.method()` calls `repository.method()`. This only happens while a
   request is being handled, over and over, one call per request.

Confusing (1) and (2) is the usual source of "I don't see how this connects" —
so this page keeps them visually separate.

---

## 1. What each folder's job is, in one line

| Folder | Job | Talks to |
|---|---|---|
| `shared/config/` | read `process.env` once, export one typed object | nothing — everything else reads *from* it |
| `shared/models/` | Mongoose schema: shape + validation + hooks | only `repository/` imports these to write data |
| `shared/utils/` | stateless helpers with no state and no side effects | called from anywhere (`AppError`, `ResponseFormatter`, `SecurityUtil`) |
| `shared/constants/` | shared vocabulary (role strings) | imported wherever a role is checked or set |
| `shared/Middleware/` | gatekeepers that run *before* a controller | attached to `app` (all routes) or a `router` (some routes) |
| `services/auth/repository/` | the only code allowed to talk to Mongoose | called only by `service/` |
| `services/auth/service/` | business rules; no `req`/`res`, no Mongoose | called only by `controller/`, built by `Dependencies/` |
| `services/auth/controller/` | HTTP adapter: `req` in, `res` out | called only by `routes/`, built by `Dependencies/` |
| `services/auth/validation/` | *what* a request body must look like (schemas) | read by `Middleware/validate.js` |
| `services/auth/Dependencies/` | the composition root — builds the object graph | imported once by `routes/` |
| `services/auth/routes/` | the switchboard: path + verb → middleware chain → controller | imported once by `server.js` |
| `server.js` | the entry point: build the app, register everything, connect, listen | imports `routes/`, `Middleware/`, `config/` |

---

## 2. The complete import graph

Every arrow is a real `import` line in the code. Read it bottom-up: the bottom
row has **zero** dependencies on the rest of the app (pure leaves); each row
above depends only on rows below it.

```
 server.js
   │ imports
   ▼
 ┌───────────────────────────┬───────────────────────────────┐
 │ shared/Middleware/*       │ services/auth/routes/authRouter.js
 │  errorHandler.js          │   │ imports
 │  authenticate.js          │   ▼
 │  authorize.js             │  services/auth/Dependencies/dependencies.js
 │  validate.js              │   │ imports
 │  requestLogger.js         │   ▼
 └──────────┬────────────────┤  ┌─────────────────────────────────┐
            │                │  │ controller/authController.js    │
            │                │  │ service/authService.js          │
            │                │  │ repository/UserRepository.js ───┼──► repository/BaseRepository.js
            │                │  └──────────────┬───────────────────┘
            │                │                 │ imports
            │                │                 ▼
            │                │           shared/models/User.js
            │                │
            │                └──► services/auth/validation/authSchema.js
            │
            ▼
 ┌─────────────────────────────────────────────────────────────┐
 │        shared/utils/*  (AppError, ResponseFormatter,        │
 │        SecurityUtil)   +   shared/constants/roles.js        │
 └───────────────────────────┬───────────────────────────────────┘
                             │ imports
                             ▼
 ┌─────────────────────────────────────────────────────────────┐
 │  shared/config/index.js  (reads process.env, the ONE root)  │
 │  shared/config/logger.js (Winston singleton)                │
 │  shared/config/{mongodb,postgres,rabbitmq}.js (connection    │
 │      singletons — object built here, NOT connected yet)      │
 └─────────────────────────────────────────────────────────────┘
```

Notice **`shared/models/User.js` is only imported by `UserRepository.js`**.
Nothing else in the whole app touches Mongoose models directly — that is the
Repository pattern doing its job. And **`config/index.js` sits at the very
bottom** — almost every other file imports it, directly or through `logger.js`,
and it imports nothing of ours.

---

## 3. The two moments that matter: import-time vs connect-time vs request-time

This is the part that is easy to miss reading the files one at a time: **the
object graph is built once, before the server can accept a single request, and
long before any database connection exists.** Three distinct moments, in order:

### Moment A — module load (import time, milliseconds, no network)

The instant you run `node src/server.js`, Node starts resolving every `import`,
depth-first, and runs each file's top-level code exactly once (Node caches
modules — a file imported from five places still only executes once).

```
node src/server.js
   │
   ├─ import "./shared/Middleware/errorHandler.js"
   │     └─ import "../config/logger.js"
   │           └─ import "./index.js" (config)     ← dotenv.config() runs HERE,
   │                                                   config object is built HERE
   │
   ├─ import "./shared/config/mongodb.js"           ← `export default new MongoConnection()`
   │                                                   BUILDS the singleton object.
   │                                                   this.connection is still null.
   │                                                   NO network call yet.
   ├─ import "./shared/config/postgres.js"          ← same: object built, pool not created
   ├─ import "./shared/config/rabbitmq.js"          ← same: object built, not connected
   │
   └─ import "./services/auth/routes/authRouter.js"
         └─ import "../Dependencies/dependencies.js"
               ├─ import AuthController, AuthService, MongoUserRepository
               │     (each of THOSE files' imports resolve first: models, utils, config...)
               │
               └─ const initialized = Container.init()      ★ THE WIRING HAPPENS HERE ★
                     userRepository = MongoUserRepository        (already an instance)
                     authService    = new AuthService(userRepository)
                     authController = new AuthController(authService)
```

**`Container.init()` runs exactly once, as a side effect of `authRouter.js`
being imported.** Nothing calls it explicitly per request. By the time
`server.js`'s own code starts running, `authController` already exists,
fully wired to a working `authService`, which is wired to the real
`MongoUserRepository`.

This explains something that looks like magic otherwise: `authRouter.js` does
`const { controllers } = dependencies;` and just *uses* `authController` — it
never constructs anything. The construction already happened, as a side effect
of one `import` line.

### Moment B — `app.use(...)` registration (still import time, still no network)

Back in `server.js`, after all imports resolve, the file's own top-level code
runs: `const app = express()`, then a series of `app.use(...)` / `app.get(...)`
calls. **These do not run any middleware yet** — they *register* it, i.e. they
push each function onto Express's internal list, in order. `app.use("/api/auth",
authRouter)` mounts the router object that was already fully built in Moment A.

### Moment C — `startServer()` (this is when the network gets touched)

Only now, at the very bottom of `server.js`, does real I/O happen:

```
startServer()
  → initializeConnection()
       await mongodb.connect()      ← the FIRST real TCP connection to MongoDB
       await postgres.testConnection()   ← the FIRST real query to Postgres
       await rabbitmq.connect()     ← the FIRST real AMQP connection
  → app.listen(config.port)         ← the port opens; the process can now
                                        accept incoming HTTP requests
```

If any of the three connections fail, `initializeConnection` throws,
`startServer`'s `catch` logs and calls `process.exit(1)` — **the port never
opens.** See `phase-4-server-bootstrap/1-concepts.md` for why that ordering is
deliberate.

### Moment D — every request, forever after

Only after `app.listen` succeeds does anything from
`phase-7-wiring-auth-end-to-end/1-request-lifecycle.md` happen. That whole
station-by-station walk (cookieParser → helmet → cors → ... → controller →
service → repository → MongoDB → response) is **Moment D**, and it repeats for
every single request, using the *same* `authController` / `authService` /
`userRepository` objects that were built once in Moment A.

**The one sentence to keep:** *wiring happens once at startup (Moments A–B),
connecting happens once at startup (Moment C), and handling happens
continuously after that (Moment D) — using the objects Moment A already built.*

---

## 4. Import vs construction, side by side

The reason `AuthService.js` has no `import UserRepository from "..."` line at
the top, even though it clearly *uses* a user repository, trips people up. Two
different files show two different wiring styles:

```js
// controller/authController.js  — receives its dependency, doesn't build it
export class AuthController {
  constructor(authService) {              // <- handed in, not imported
    if (!authService) throw new Error("auth Service is Required");
    this.authService = authService;
  }
}
```

```js
// Dependencies/dependencies.js — the ONE file that builds the graph
import { AuthController } from "../controller/authController.js";
import { AuthService } from "../service/authService.js";
import MongoUserRepository from "../repository/UserRepository.js";

class Container {
  static init() {
    const repositories = { userRepository: MongoUserRepository };
    const services     = { authService: new AuthService(repositories.userRepository) };
    const controllers  = { authController: new AuthController(services.authService) };
    return { repositories, services, controllers };
  }
}
```

So: `authController.js` and `authService.js` **never import each other**. Only
`dependencies.js` imports both, and only `dependencies.js` decides which
concrete repository goes in. This is *why* you can swap `MongoUserRepository`
for a fake one in a test, or a `PostgresUserRepository` in production, by
editing **one line, in one file** — every other file is unaffected because none
of them hard-code the concrete class.

---

## 5. Per-file "who calls me / who do I call" cards

### `shared/config/index.js`
- **Called by (imported by):** almost everything, directly or via `logger.js`.
- **Calls:** nothing of ours; reads `process.env`.
- **When it runs:** its top-level code (`dotenv.config()`, building the object)
  runs once, the first time anything imports it — which in practice is one of
  the very first things that happens (Moment A).

### `shared/config/{mongodb,postgres,rabbitmq}.js`
- **Called by:** `server.js` (`mongodb.connect()`, `postgres.testConnection()`,
  `rabbitmq.connect()`, and the matching `close()`/`disconnect()` calls in
  `gracefulShutdown`).
- **Calls:** `config/index.js` for connection strings, `logger.js` to report
  status.
- **When:** the *object* is built at import time (Moment A); the actual
  *connection* is opened only inside `startServer()` (Moment C).

### `shared/models/User.js`
- **Called by:** only `repository/UserRepository.js` (`new this.model(data)`,
  `this.model.findById(...)`, etc.).
- **Calls:** `bcryptjs` (hash the password in `pre('save')`), `SecurityUtil.js`
  (the password-policy validator).
- **Nothing outside `repository/` should ever `import User from ".../User.js"`**
  — that is the rule the Repository pattern exists to enforce.

### `shared/utils/{AppError,ResponseFormatter,SecurityUtil}.js`
- **Called by:** everywhere. `AppError` — thrown from services (`authService`).
  `ResponseFormatter` — called from controllers and from middleware that
  respond directly (`authenticate`, `authorize`, `validate`, `errorHandler`).
  `SecurityUtil` — called from `User.js`'s password validator.
- **Calls:** nothing of ours. Pure, stateless.

### `shared/constants/roles.js`
- **Called by:** `authController.js` (`APPLICATION_ROLES.SUPER_ADMIN`),
  `authRouter.js` (the `authorize([...])` argument), `authSchema.js`
  (`isValidRole` in the `custom` rule), `authService.js`.
- **Calls:** nothing.

### `shared/Middleware/*`
- **Called by:** `server.js` (`errorHandler`, app-level) and `authRouter.js`
  (`authenticate`, `authorize`, `validate`, `requestLogger`, route-level).
- **Calls:** `ResponseFormatter` (to format a rejection), `jsonwebtoken`
  (`authenticate`), `config` (secrets/expiry), `logger`.
- **When:** registered once at import time (Moment B); **executed once per
  matching request** (Moment D) — every request re-runs the middleware function,
  it is not "built once" the way the DI objects are.

### `services/auth/repository/{Base,User}Repository.js`
- **Called by:** `authService.js` only (`this.userRepository.create(...)`,
  `.findByUsername(...)`, `.count(...)`, etc.) — and it only has that reference
  because `dependencies.js` handed it one in the constructor.
- **Calls:** the `User` Mongoose model, `logger`.

### `services/auth/service/authService.js`
- **Called by:** `authController.js` only.
- **Calls:** `this.userRepository.*` (whatever was injected), `jsonwebtoken`,
  `AppError`, `logger`, `config`.
- **Never touches:** `req`, `res`, Express, or Mongoose directly.

### `services/auth/controller/authController.js`
- **Called by:** the route handlers in `authRouter.js` (via the arrow-wrap that
  preserves `this`).
- **Calls:** `this.authService.*`, `res.cookie`, `res.status().json()`,
  `ResponseFormatter`, `next(error)`.

### `services/auth/validation/authSchema.js`
- **Called by:** `authRouter.js`, passed *into* `validate(schema)`.
- **Calls:** `isValidRole` from `roles.js` inside its `custom` rule.

### `services/auth/Dependencies/dependencies.js`
- **Called by:** `authRouter.js` (`import dependencies from "../Dependencies/dependencies.js"`).
- **Calls:** `new AuthService(...)`, `new AuthController(...)` — the only file in
  the whole codebase that constructs these.
- **Runs:** once, at import time (Moment A), as a side effect of being imported.

### `services/auth/routes/authRouter.js`
- **Called by:** `server.js` (`app.use("/api/auth", authRouter)`).
- **Calls:** `dependencies` (to get the controller), every `Middleware/*` file,
  `authSchema.js`.
- **Defines:** the five `router.METHOD(path, ...middleware, handler)` lines —
  the only place that says which middleware run for which URL.

### `server.js`
- **Called by:** nobody — it is the entry point (`node src/server.js`).
- **Calls:** everything above, directly or indirectly. The one file that both
  *assembles* the HTTP layer (`app.use`, `app.get`) and *starts* the process
  (`initializeConnection`, `app.listen`, the shutdown handlers).

---

## 6. Request time, condensed (full detail in Phase 7)

Once Moments A–C are done and the server is listening, every request repeats
this — using the objects already built, never rebuilding them:

```
HTTP request
  → app-level middleware (cookieParser, helmet, cors, body parsers, logger)
  → authRouter matches VERB + path
  → route-level middleware (requestLogger, [authenticate, [authorize]], validate)
  → controller.method(req, res, next)        -- reads req, calls ONE service method
  → service.method(...)                      -- the business rule
  → repository.method(...)                   -- the only Mongoose call
  → MongoDB
  → back up: controller sets cookie + res.json(ResponseFormatter.success(...))
  → res "finish" event → requestLogger writes the access-log line
```

Full beginner-level detail, every station explained, is
[phase-7-wiring-auth-end-to-end/1-request-lifecycle.md](phase-7-wiring-auth-end-to-end/1-request-lifecycle.md).
This section is the "already know the shape, need the reminder" version.

---

## 7. Worked example — adding a `Client` feature, in wiring order

The clearest way to *prove* you've internalised the wiring is to add the next
feature the same shape. This is the order that actually works, file by file
(none of this exists yet — it's the recipe, not a report):

1. **`shared/models/Client.js`** already exists (Phase 2) — the shape is there.
2. **`services/client/repository/ClientRepository.js`** — `extends
   BaseRepository` (or write a new base), `super(Client)`, implement
   `create`/`findById`/... against the `Client` model. *Only this file imports
   `Client.js`.*
3. **`services/client/service/clientService.js`** — the rules ("slug must be
   unique", "only a super_admin may create a client"). Constructor takes a
   `clientRepository`. No `req`/`res`.
4. **`services/client/controller/clientController.js`** — constructor takes a
   `clientService`. One method per endpoint, each: read `req`, call one service
   method, shape `res`.
5. **`services/client/validation/clientSchema.js`** — the request-shape rules
   for create/update.
6. **`services/client/Dependencies/dependencies.js`** — the composition root
   for *this* feature:
   `clientRepository = ClientRepository; clientService = new ClientService(clientRepository);
   clientController = new ClientController(clientService);`
7. **`services/client/routes/clientRouter.js`** — import this feature's
   `dependencies`, `authenticate`, `authorize`, `validate`, the schemas; declare
   `router.post("/", authenticate, authorize([...]), validate(schema),
   (req,res,next) => clientController.create(req,res,next))` and so on.
8. **`server.js`** — one new line:
   `import clientRouter from "./services/client/routes/clientRouter.js";` and
   `app.use("/api/clients", clientRouter);`.

Notice steps 1–7 touch **nothing outside `services/client/`** except importing
shared middleware and the existing model. Step 8 is the only edit to a shared
file. That containment is the entire payoff of the layered, feature-first
layout from Phase 6.
