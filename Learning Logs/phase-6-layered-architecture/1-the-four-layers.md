# 1 · The four layers, and the one rule

**Mental model:** water flows downhill. A request enters at the top and each
layer hands work to the one below it — never the reverse.

---

## The layers

```
   Router        maps  VERB /path  →  a controller method, attaches middleware
     │  calls
     ▼
   Controller    HTTP only: read req, call ONE service method, shape res
     │  calls
     ▼
   Service       business rules & decisions; knows nothing about req/res
     │  calls
     ▼
   Repository    data access; the ONLY layer that touches the ODM / SQL
     │  uses
     ▼
   Model (Mongoose)  →  MongoDB
```

**The rule that makes it worth doing:** a layer may call **down**, never up,
never sideways into a sibling's internals. The controller must not run a query.
The service must not read `req.body` or call `res.json`. The repository must not
know what a JWT is. Break the rule once and the layering stops paying rent.

Why the discipline helps *here*: the service's job — "only one super admin may
ever be onboarded" — is a **rule**, and rules are where bugs hide. Isolating it
from Express and Mongoose means it can be tested by calling
`authService.onboardSuperAdmin(data)` with a fake repository — no server, no DB.

## Repository pattern

A class between the service and the database that exposes **intent-named
methods** (`findByEmail`, `findAll`) instead of query syntax. The service says
*what* it wants; the repository knows *how*. Two files:

- **`BaseRepository`** — an abstract base; every method throws
  `"Method not implemented"`. A written-down contract, standing in for JS's
  missing `interface` keyword.
- **`MongoUserRepository extends BaseRepository`** — the concrete Mongoose
  implementation.

The payoff is the seam: today the "thing with `findAll`" talks to MongoDB; a
test passes an object literal with two fake functions.

## Service layer

Where decisions live. No `req`, no `res`, no status codes. Reusable — a CLI seed
script could call `onboardSuperAdmin` directly.

## Controller

The thinnest layer. Reads *translate HTTP in → call service → translate result to
HTTP out*, with no `if` that is a business rule.

## Dependency Injection and the composition root

None of these classes create their own dependencies — `AuthService` is *given* a
repository, `AuthController` a service; both throw in the constructor if it's
missing. That's **Inversion of Control**: the class declares what it needs,
someone else supplies it.

`Dependencies/dependencies.js` is that someone — the **composition root**, the
single place that knows the concrete wiring. Everywhere else asks the container
for a ready-made object; nothing else calls `new AuthService(...)`.

## Feature-first folders (vertical slice)

- **Layer-first:** `controllers/auth.js`, `services/auth.js` — group by *kind*.
- **Feature-first:** `services/auth/{controller,service,repository,...}` — group
  by *feature*, layers inside. ← this project.

Adding the `client` feature = adding `services/client/` with the same
sub-folders; deleting it = `rm -r` one directory. The cost is more folders for a
small feature.

## Higher-order middleware

`authorize` is a **middleware factory**: `authorize(["super_admin"])` returns the
actual `(req, res, next)` function, closed over that list. One generic role check
reused with a different role set per route. `authenticate` takes no config, so
it's a plain middleware.

## Authentication vs authorization

- **`authenticate`** — *who are you*: read the `authToken` cookie, verify
  signature + expiry, attach a trusted `req.user` from the token payload.
- **`authorize(roles)`** — *are you allowed*: assumes `authenticate` ran, checks
  `req.user.role` against `roles`.

Order: `authenticate` → `authorize` → controller. The token is **stateless** —
identity and role live in the signed payload, so a protected request needs no
DB lookup. It sits in an **`httpOnly`** cookie, unreadable by page JavaScript,
blunting token theft via XSS.
