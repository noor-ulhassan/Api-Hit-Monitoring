# Phase 3 — The HTTP contract

**One line:** one error type and one response shape, built before the first
route so every route conforms.

**Commit:** `1b49f97`  **Date:** 29 Aug 2026

**State after this phase:** two small utility classes in `shared/utils/` —
`AppError` and `ResponseFormatter`. Nothing uses them yet: no route, no
controller, no error middleware. Plumbing laid before the pipe.

---

## Files this phase touched

```
server/src/shared/utils/
├─ AppError.js           Error subclass: { statusCode, errors, isOperational }
└─ ResponseFormatter.js  static builders for one envelope:
                         success / error / validationError / paginated
```

## Read in this order

1. **[1-app-error.md](1-app-error.md)** — a thrown error that also carries the
   HTTP status and an "I meant this" flag.
2. **[2-response-formatter.md](2-response-formatter.md)** — one JSON shape for
   every reply, so the frontend parses one structure.

## The gist

- **`throw new Error("x")` carries only a string.** `AppError` attaches
  `statusCode` (the thrower decides the meaning), `errors` (structured detail),
  and `isOperational` (always `true`).
- **Operational error vs bug.** An `AppError` is one you meant to throw — safe to
  report to the client. Anything that *isn't* an `AppError` is a bug: log it,
  send a generic 500. `isOperational` is the label that lets one handler tell
  them apart.
- **Fail-safe default:** both classes default `statusCode` to 500 — a forgotten
  status should read as "server broke", visible in monitoring, not a silent 200.
- **One envelope, always:** `{ success, data|error, message, timestamp }` so the
  client writes `if (res.success) use(res.data) else show(res.message)` once.
- The formatter returns a **plain object** — it does not call `res.json`.
  Formatting and transport stay separate.

## Issues opened here

The four `ResponseFormatter` methods do not agree on their own fields
(`statusCode` in two of four; arg order flips between `success` and `error`;
`paginated` divides by `limit` with no guard). And `AppError.errors` (plural)
clashes with the formatter's `error` (singular) parameter. All tracked in
[../OPEN-ISSUES.md](../OPEN-ISSUES.md).
