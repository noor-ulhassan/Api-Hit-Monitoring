# 1 · `utils/AppError.js`

**Mental model:** the set of errors you *meant* to throw. Anything that isn't an
`AppError` is a bug until proven otherwise.

---

**What we did.** An eleven-line file: one class, `AppError extends Error`.
Constructor `(message, statusCode = 500, errors = null)`; sets four properties.

**What it does.** `throw new AppError("Not found", 404)` produces a normal
`Error` (has `.message`, `.stack`) *plus* three fields the rest of the app can
read: `.statusCode` (the HTTP code this error should produce), `.errors`
(optional structured detail), `.isOperational` (always `true`). An
error-handling middleware can read those to decide the status and body. As of
this phase nothing throws one and nothing consumes one — it's the primitive.

**Why it is built this way:**

- **`super(message)`** — hands the text to `Error` so `err.message`, `throw`
  semantics, and stack capture still work.
- **`statusCode`, default 500** — the thrower states the meaning
  (`new AppError("Conflict", 409)`); if forgotten, 500 is the safe assumption. A
  plain `throw new Error("...")` carries none of this, so a handler would have to
  string-match the message — brittle.
- **`errors`, default `null`** — a slot for a list of field problems
  (`[{ field, message }]`) when one line of message isn't enough.
- **`isOperational = true`, hard-coded** — being an `AppError` *is* the
  definition of "an error I threw on purpose". You never construct a
  non-operational one; that's just a bare `Error`. A raw `TypeError` reaching a
  handler has no `isOperational` field — which is how a handler *can* tell a
  deliberate error from a bug, if it checks (the Phase 4 handler does not).
- **`Error.captureStackTrace(this, this.constructor)`** — a V8 feature that
  builds `.stack` while omitting the frames inside this constructor, so the
  trace starts at the `new AppError(...)` call site, not inside `AppError.js`.

No named subclasses (`NotFoundError`, ...) — the thrower passes the code by
hand. Fine to start; subclasses are the usual later refinement once the same
`(message, code)` pairs recur.

---

## Operational error vs programmer error

The load-bearing idea. Two kinds, treated oppositely:

| | Operational error | Programmer error (bug) |
|---|---|---|
| examples | "email taken", "not found", "token expired", "DB timeout" | `undefined is not a function`, a null deref, a typo |
| expected? | yes | no |
| process healthy? | yes | maybe not — state may be corrupt |
| right response | tell the client cleanly (4xx/5xx + message) | log the stack, send a generic 500, in prod let it restart |
| show `err.message`? | yes | no — can leak internals |

`isOperational: true` is the label. Sees the flag → trust `err.message` /
`err.statusCode`, forward them. No flag → treat as a bug.
