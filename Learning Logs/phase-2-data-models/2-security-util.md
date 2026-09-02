# 2 · `SecurityUtil.js`

**Mental model:** the password rulebook, living outside any model so a
registration route (or a test, or a seed script) can check a password and get
back *every* reason it failed — before a `User` object exists.

---

**What we did.** `src/shared/utils/SecurityUtil.js` — one class,
`SecurityUtils`, no instances: a static config object (`PASSWORD_REQUIREMENTS`)
and one static method (`validatePassword`).

**What it does.** `SecurityUtils.validatePassword("hunter2")` →
`{ success: false, errors: ["Password must be at least 8 chars long!", ...] }`
— a boolean plus every rule the password broke. `User.js` calls it from the
`password` validator; being a plain static method, anything else can call it
directly too.

**Why it is built this way.**

- **`PASSWORD_REQUIREMENTS` is read from `process.env` at module load**
  (`PASSWORD_MIN_LENGTH`, `PASSWORD_REQUIRE_UPPERCASE`, + three siblings), each
  with a hard-coded default and `=== "true"` coercion. Because it reads
  `process.env` directly, it breaks the "only `config/index.js` touches
  `process.env`" rule (Issue).
- **Accumulate, don't fail fast.** Every unmet rule is pushed, so the caller can
  show all problems at once. Only empty input short-circuits.
- **`success` is derived** (`errors.length === 0`), never set directly — one
  source of truth.
- **The weak-password list is a lowercased exact-match check.** It catches
  `Password123` because that literal is listed; `P@ssw0rd!` passes. A token
  gesture, not a real breached-password check (that needs a large dataset or a
  k-anonymity API).

**Wiring.** `User.js` consumes it twice: the validator returns
`validation.success` (a boolean, as Mongoose requires); the `message` function
re-runs the validator to join `errors` into one `"Rule one. Rule two."`
sentence — slightly wasteful, but keeps the message text and the pass/fail logic
from drifting apart.

**Docstring intent:** grow this class into token generation, key generation, and
encryption — the natural home for security helpers more than one model needs.
None of that is built.
