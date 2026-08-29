# 03 - The Response Envelope and Error Handling

**Covers commits:** `1b49f97` (Response Formatter & AppError). One code commit.
`18af91e` sits between Phase 02 and this one but is only the Phase 02 log.
**Date range of work:** 29 Aug 2026.
**State of the app at end of this phase:** two small utility classes exist -
`AppError` (a thrown error that carries an HTTP status and an "I meant this"
flag) and `ResponseFormatter` (one JSON shape for every reply). Nothing uses
them yet: no route, no controller, no error-handling middleware. This is plumbing
laid before the pipe. `server.js` is still the Phase 01 stub.

The code is 56 lines across two files. The value of this log is the reasoning
those 56 lines assume.

---

## 1. Scope

Two files, one concern: the boundary between the app and the HTTP client.

- `src/shared/utils/AppError.js` - a custom `Error` subclass that attaches a
  status code and a classification flag to the error object, so one central
  handler can turn any `throw` into the correct response.
- `src/shared/utils/ResponseFormatter.js` - static builders that return the
  single response-object shape every endpoint will send: `success`, `error`,
  `validationError`, `paginated`.

No middleware wires them in. That is the next phase.

---

## 2. Context: why build these before any route exists

You could add a response shape and error handling later, once there are routes to
need them. Building them first is a deliberate choice: it forces every future
route to be written against **one contract** instead of each one inventing its
own `res.json(...)`. Retrofitting consistency onto twenty hand-rolled endpoints
costs far more than writing one class now.

This is the same move as `SecurityUtils` in Phase 02: take a concern that cuts
across everything, put it in a small stateless class in `shared/`, and let every
route, the producer, and the consumer use the identical copy.

---

## 3. Concepts

### 3a. Why a custom error class at all

`throw new Error("user not found")` carries exactly one thing: a string. Whatever
catches it has no reliable way to know this should be a `404` and not a `500`, or
whether the message is safe to show the client. It would have to match on the
text - brittle and embarrassing.

`AppError` attaches the missing facts **to the thrown object itself**:

- `statusCode` - the HTTP status this error should produce.
- `errors` - an optional slot for structured detail (a list of field problems).
- `isOperational` - "this is an error I expected and threw on purpose."

Now one error-handling middleware can do
`res.status(err.statusCode || 500).json(...)` and stop. Every route throws; one
place answers. **The thrower decides the meaning; the handler decides the
mechanics.**

### 3b. Operational errors vs bugs - what `isOperational` is for

This is the load-bearing idea in the file. Errors come in two kinds, and you
treat them oppositely:

| | Operational error | Programmer error (bug) |
|---|---|---|
| Examples | "email already taken", "not found", "token expired", "DB timeout" | `undefined is not a function`, a null deref, a typo |
| Did you expect it? | Yes | No |
| Is the process still healthy? | Yes | Maybe not - state may be corrupt |
| Correct response | Tell the client cleanly: 4xx/5xx + message | Log the full stack, send a generic 500, in production let the process restart |
| Safe to show `err.message`? | Yes | No - it can leak internals |

`isOperational: true` is the label that lets the central handler tell them apart.
Sees the flag -> trust `err.message` and `err.statusCode`, forward them. No flag
(a raw `TypeError` bubbled up) -> treat as a bug: generic message to the client,
full detail to the logs, alert someone.

Memorable version: **`AppError` is the set of errors you meant to throw. Anything
that is not an `AppError` is a bug until proven otherwise.**

### 3c. Fail-safe defaults

Both `AppError` (`AppError.js:2`) and `ResponseFormatter.error`
(`ResponseFormatter.js:12`) default `statusCode` to **500** - not 200, not 400.
Reason: if a code path forgets to say what went wrong, the safe assumption is
"the server broke." A 500 makes clients back off and makes the failure show up
in monitoring. A silent 200 with an error buried inside is the worst outcome -
the failure is invisible to everyone.

### 3d. `Error.captureStackTrace(this, this.constructor)`

A V8 (Node) feature, `AppError.js:7`. It builds the `.stack` string on the new
error **and omits the frames inside the `AppError` constructor**, so the trace
starts at the line that wrote `new AppError(...)` - the actual problem site -
instead of inside this file. Without it, every AppError stack would open with two
useless frames pointing back at `AppError.js`. Small quality-of-life win, and the
standard idiom for custom error classes.

### 3e. One response envelope, always

If each endpoint shapes its own JSON, the frontend special-cases every route:
sometimes `{ user }`, sometimes `{ data, ok }`, sometimes a bare array. If every
endpoint returns the same wrapper, the client writes the parse once:

```
if (res.success) { use(res.data) } else { show(res.message) }
```

`ResponseFormatter` is that wrapper. The fields that never change:

- `success` - boolean; the first thing the client checks.
- `data` (on success) / `error` (on failure) - the payload slot.
- `message` - a human-readable summary, safe to drop in a toast.
- `timestamp` - ISO 8601; useful for logs, clock-skew debugging, client cache
  logic.

Note the formatter returns a **plain object** - it does not call `res.json`. The
route decides transport:
`res.status(x).json(ResponseFormatter.success(...))`. Build the shape in one
place, send it wherever. Formatting and transport stay separate.

### 3f. Why `totalPages` is computed on the server

`paginated()` (`ResponseFormatter.js:30`) returns `page`, `limit`, `total`, and
`totalPages = Math.ceil(total / limit)`. The server already has `total` from the
query count, so computing `totalPages` here means every client gets the same
number and none of them can round it wrong. Anything the server can compute once,
it should - don't make N clients redo it.

---

## 4. Walkthrough

Each file gets the same pass: **what we did**, **what it does**, **why it is
built that way**. Bugs are named here and detailed in section 5.

### 4a. `AppError.js`

**What we did.** Added an eleven-line file: one class, `AppError`, that extends
the built-in `Error`. Its constructor is
`(message, statusCode = 500, errors = null)` and it sets four properties on the
new object.

**What it does.** When code somewhere does `throw new AppError("Not found",
404)`, the thrown object is a normal `Error` (it has `.message` and `.stack`)
*plus* three extra fields the rest of the app can read: `.statusCode` (the HTTP
code this error should produce), `.errors` (optional structured detail), and
`.isOperational` (always `true`). The central error middleware - built in Phase
04 - reads those fields to decide what status and body to send. Nothing throws an
`AppError` yet; this is the type the error path will be built around.

**Why it is built this way.**

- **`super(message)`** - hands the text to `Error` so `err.message`, `throw`
  semantics, and stack capture all still work normally.
- **`statusCode`, default 500** - the thrower states intent
  (`new AppError("Conflict", 409)`); if it is forgotten, 500 is the safe
  assumption (see 3c). A plain `throw new Error("...")` carries none of this, so
  the handler would have to string-match the message - brittle.
- **`errors`, default `null`** - a slot for a list of field problems
  (`[{ field, message }]`) when one line of message is not enough, e.g. a
  rejected form.
- **`isOperational = true`, hard-coded** - being an `AppError` *is* the
  definition of "an error I threw on purpose" (see 3b). You never construct a
  non-operational one; that is just a bare `Error`. A raw `TypeError` reaching
  the handler therefore has no `isOperational`, which is exactly how the handler
  tells a deliberate error from a bug.
- **`Error.captureStackTrace(this, this.constructor)`** - a V8 feature that
  builds `.stack` while omitting the frames inside this constructor, so the trace
  starts at the `new AppError(...)` call site instead of inside `AppError.js`
  (see 3d).

No named subclasses (`NotFoundError`, `ValidationError`, ...) - the thrower
passes the code by hand each time. Fine to start; subclasses are the usual later
refinement once the same `(message, code)` pairs keep recurring.

### 4b. `ResponseFormatter.js`

**What we did.** Added a 45-line file: one class, `ResponseFormatter`, with four
static methods and no instances (same shape as `SecurityUtils` in Phase 02).
Each method returns a plain object; none of them touch `res`.

**What it does.** Each method builds one variant of the standard response
envelope, stamped with `timestamp: new Date().toISOString()`. A route calls, say,
`ResponseFormatter.success(user)` and passes the result to
`res.status(200).json(...)`. Every endpoint that does this sends the same
outer shape, so the frontend parses one structure everywhere.

| Method | Object it returns | Called for |
|---|---|---|
| `success(data = null, message = "success", statusCode = 200)` | `{ success: true, data, message, statusCode, timestamp }` | Any 2xx reply with a payload. |
| `error(message = "error", statusCode = 500, error = null)` | `{ success: false, error, message, statusCode, timestamp }` | Any failure. Mirror of `success`, payload slot renamed `error`. |
| `validationError(error = null)` | `{ success: false, error, message: "Validation Failed", timestamp }` | A bad request body; `error` holds the field-level list. Preset message for the common case. |
| `paginated(data = null, page, limit, total)` | `{ success: true, data, pagination: { page, limit, total, totalPages }, timestamp }` | List endpoints; adds "where am I in the set". |

**Why it is built this way.**

- **One envelope, always** - so the client writes `if (res.success) use(res.data)
  else show(res.message)` once instead of special-casing every route (see 3e).
- **`data` on success, `error` on failure** - the same slot, named for what it
  holds, so the client knows which to read from the `success` flag alone.
- **Returns a plain object, does not call `res.json`** - formatting and transport
  stay separate; the route decides status and sending, the formatter only builds
  the shape.
- **`paginated` computes `totalPages = Math.ceil(total / limit)` server-side** -
  the server already has `total` from the query count, so every client gets the
  same number and none of them round it wrong (see 3f).
- **Static methods, no state** - it is a namespace of pure functions;
  `new ResponseFormatter()` would be pointless.

The intent is right, but the four methods do not yet agree with each other on
their own fields - `statusCode` is present in two and absent in two, and the
argument order flips between `success` and `error` (Issues 1-6).

---

## 5. Issues, shortcuts, and TODO

Blunt list.

1. **The envelope is not actually uniform yet.** `success()` and `error()` put
   `statusCode` in the body; `validationError()` and `paginated()` do not. A
   class whose whole job is killing shape drift currently ships four shapes.
   Decide: always include `statusCode`, or (more common) never - it is already
   on the HTTP status line.
2. **Body `statusCode` can contradict the real HTTP status.** Nothing ties
   `ResponseFormatter.success(data, msg, 201)` to `res.status(201)`. Two sources
   of truth for one fact. Prefer the HTTP status; if the body field stays, the
   middleware must set both from one value.
3. **`error` vs `errors` naming clash.** `AppError` stores detail in
   `this.errors` (plural); `ResponseFormatter.error()` / `validationError()`
   take `error` (singular). The middleware will bridge `err.errors -> error` -
   it works, it reads badly. Pick one spelling project-wide.
4. **Argument order flips between the two mirrors.**
   `success(data, message, statusCode)` vs `error(message, statusCode, error)` -
   the `message` / `statusCode` slots move. Easy to mis-call. Align them.
5. **`paginated()` divides by `limit` with no guard.** `limit = 0` gives
   `totalPages: Infinity`; `total = 0, limit = 0` gives `NaN`. Clamp `limit` to
   at least 1, or special-case the empty result.
6. **`validationError()` carries no status code.** A validation failure is
   normally `400` or `422`; the method neither sets nor accepts one. Add it.
7. **Nothing consumes either file.** No middleware reads `err.statusCode` /
   `err.isOperational`; no route calls the formatter. Until the middleware
   exists these are untested contracts.
8. **`AppError` cannot represent a non-operational error.** By design (3b), but
   be explicit about it: if you ever want an `AppError` subclass for a genuinely
   fatal state, `isOperational` has to become a constructor parameter.

---

## 6. Commit history for this phase

| Commit | What landed and why |
|---|---|
| `18af91e` Data models explanation | The Phase 02 log (`02-data-models-and-security-utils.md`) and its README index row. No code. |
| `1b49f97` Response Formatter & AppError | `AppError.js` - `Error` subclass carrying `statusCode`, `errors`, `isOperational`, plus `captureStackTrace` for a clean trace. `ResponseFormatter.js` - four static builders for the success / error / validationError / paginated envelope. The HTTP contract, written before the first route so every route is held to it. |

Uncommitted at time of writing: this file and its README row.

---

## 7. Glossary additions

- **Operational error.** One you anticipated and handle on purpose (not found,
  bad input, upstream timeout). Safe to report to the client; the process stays
  healthy.
- **Programmer error / bug.** An unanticipated error (bad reference, type
  error). Not safely recoverable - log it, send a generic 500, restart in
  production.
- **`isOperational` flag.** The boolean on `AppError` that lets one central
  handler separate the two above.
- **Response envelope.** A fixed outer object (`success`, `data` / `error`,
  `message`, `timestamp`) wrapped around every reply so clients parse one
  structure instead of twenty.
- **Fail-safe default.** When information is missing, pick the option that makes
  failure visible and safe - here, HTTP 500 rather than 200.
- **Central error-handling middleware.** (Next phase.) One Express
  `(err, req, res, next)` that every route's errors funnel into; it reads
  `err.statusCode` / `err.isOperational`, formats with `ResponseFormatter`, and
  logs bugs.

---

## 8. What comes next (expected)

1. The **error-handling middleware**: an Express `(err, req, res, next)` that
   checks `err.isOperational`, uses `err.statusCode || 500`, formats with
   `ResponseFormatter.error` / `.validationError`, logs non-operational errors
   through the Winston logger, and never leaks a stack trace to the client.
2. A **404 handler** for unmatched routes that throws
   `new AppError("Not Found", 404)`.
3. Decide whether an **async wrapper** (`catchAsync`) is needed. Express 5
   forwards rejected promises to the error middleware on its own (Phase 01,
   section 5), so it may not be.
4. **Reconcile the four `ResponseFormatter` shapes** (Issues 1-6) before routes
   start depending on them.
5. First real routes - auth register/login - exercising both utilities end to
   end.
