# 3 · `shared/Middleware/errorHandler.js`

**Mental model:** the one place a thrown error becomes a response. Routes
`throw` and forget; this decides the status, the log line, and the body shape.

---

**What we did.** A 37-line Express error-handling middleware, registered as the
final `app.use` in `server.js`.

**What it does at runtime.** Invoked only when a route calls `next(err)`, throws
synchronously, or (Express 5) returns a rejected promise. For each error:

1. seed `statusCode`, `message`, `errors` from the error object;
2. write one Winston `error` line (message, status, stack, request path +
   method);
3. inspect `err.name` and, for four known framework error types, override the
   status + message:

| `err.name` | → | Why |
|---|---|---|
| `ValidationError` (Mongoose) | 400, `"Validation Error"`, `errors` = field messages | bad input, not a server fault |
| `MongoServerError` + `code 11000` | 409, `"Duplicate key error"` | a unique-index collision — 409 Conflict is honest |
| `JsonWebTokenError` | 401, `"Invalid token"` | malformed / bad-signature JWT |
| `TokenExpiredError` | 401, `"Token expired"` | valid JWT past expiry — own message so the client refreshes |

4. send `res.status(statusCode).json(ResponseFormatter.error(message, statusCode,
   errors))`.

**Why it is built this way.** Routes should be free to `throw` and forget;
exactly one place should decide the status code, the log line, and the body
shape. Framework-specific error translation (Mongoose, JWT) lives here, not in a
`try/catch` copied into every handler.

**Where it falls short (Issues):**

- reads `req.statusCode` where it means `err.statusCode` — so an `AppError`'s own
  code is ignored unless an `err.name` branch matches; `AppError("x", 404)`
  becomes 500;
- never checks `err.isOperational` — a raw bug's `err.message` can still reach
  the client;
- logs everything at `error` level, including 404s and validation failures — real
  5xx incidents get buried;
- **currently unreachable** — no route throws or calls `next(err)`, and the 404
  handler self-responds.
