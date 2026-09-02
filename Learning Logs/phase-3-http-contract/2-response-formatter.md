# 2 · `utils/ResponseFormatter.js`

**Mental model:** one JSON envelope for every reply, so the frontend writes the
parse once — `if (res.success) use(res.data) else show(res.message)`.

---

**What we did.** A 45-line file: one class, four static methods, no instances
(same shape as `SecurityUtils`). Each returns a plain object; none touch `res`.

**What it does.** Each method builds one variant of the standard envelope,
stamped `timestamp: new Date().toISOString()`. A route calls
`ResponseFormatter.success(user)` and passes the result to
`res.status(200).json(...)`.

| Method | Object it returns | For |
|---|---|---|
| `success(data=null, message="success", statusCode=200)` | `{ success:true, data, message, statusCode, timestamp }` | any 2xx with a payload |
| `error(message="error", statusCode=500, error=null)` | `{ success:false, error, message, statusCode, timestamp }` | any failure — mirror of `success`, payload slot renamed `error` |
| `validationError(error=null)` | `{ success:false, error, message:"Validation Failed", timestamp }` | a bad request body; `error` holds the field list |
| `paginated(data=null, page, limit, total)` | `{ success:true, data, pagination:{ page, limit, total, totalPages }, timestamp }` | list endpoints |

**Why it is built this way:**

- **One envelope, always** — the client special-cases nothing.
- **`data` on success, `error` on failure** — the same slot, named for what it
  holds; the client picks which to read from the `success` flag alone.
- **Returns a plain object, does not call `res.json`** — formatting and
  transport stay separate; the route decides status and sending.
- **`paginated` computes `totalPages = Math.ceil(total / limit)` server-side** —
  the server already has `total` from the query count, so every client gets the
  same number and none round it wrong.
- **Static methods, no state** — a namespace of pure functions;
  `new ResponseFormatter()` would be pointless.

**Not uniform yet (Issues).** The four methods disagree: `statusCode` is in
`success` / `error` but not `validationError` / `paginated`; argument order flips
between `success(data, msg, code)` and `error(msg, code, error)`; `paginated`
divides by `limit` with no zero guard (`Infinity` / `NaN`); `validationError`
takes no status. And `AppError` stores detail in `.errors` (plural) while this
class's parameter is `error` (singular).
