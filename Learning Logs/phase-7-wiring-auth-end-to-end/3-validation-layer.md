# 3 · The validation layer — `validate.js` + `authSchema.js`

**Mental model:** a bouncer at the door with a short checklist. It does not
inspect everything — just enough to turn away obviously-wrong requests before
they cost a database round-trip.

---

## Why a validation layer at all

Without it, a request like `{ }` (no fields) or `{ password: 123 }` (wrong type)
flows all the way into the service and the model, and fails somewhere deep — with
a confusing error, after wasting a DB call. A validation middleware fails it
**at the door**, with a clear message, and cheaply.

There are two files:

- **`services/auth/validation/authSchema.js`** — *what* to check, per route.
- **`shared/Middleware/validate.js`** — *how* to check it (reusable for any
  feature).

---

## `authSchema.js` — the schemas *(commit `8c514c6`)*

```js
export const onboardSuperAdminSchema = {
  username: { required: true },
  email:    { required: true },
  password: { required: true, minLength: 6 },
};

export const registrationSchema = {
  username: { required: true },
  email:    { required: true },
  password: { required: true, minLength: 6 },
  role: {
    required: false,
    custom: (value) => {
      if (!value) return null;                         // absent is fine
      return isValidRole(value) ? null : "Invalid role";
    },
  },
};

export const loginSchema = {
  username: { required: true },
  password: { required: true },
};
```

A schema is a plain object: `{ fieldName: { rule: value, ... } }`. Supported
rules: `required` (boolean), `minLength` (number), `custom` (a function returning
`null` for OK or an error string). `custom` also receives the whole body as a
second argument, for cross-field checks.

`registrationSchema.role` uses `custom` + `isValidRole` (from
`shared/constants/roles.js`) so a caller can't register a user with role
`"emperor"`.

---

## `validate.js` — the middleware factory *(commit `268b43f`)*

```js
const validate = (schema) => (req, res, next) => {
  if (!schema) return next();

  const errors = [];
  const body = req.body || {};

  Object.entries(schema).forEach(([field, rules]) => {
    const value = body[field];

    if (rules.required && (value === undefined || value === null || value === "")) {
      errors.push(`${field} is required`);
      return;                                  // don't run other rules on a missing field
    }
    if (rules.minLength && typeof value === "string" && value.length < rules.minLength) {
      errors.push(`${field} must be at least ${rules.minLength} characters`);
    }
    if (typeof rules.custom === "function") {
      const customErr = rules.custom(value, body);
      if (customErr) errors.push(customErr);
    }
  });

  if (errors.length) {
    return res.status(400).json(ResponseFormatter.error("Validation failed", 400, errors));
  }
  next();
};
```

**What it does.** `validate(schema)` returns a middleware closed over that
schema. The middleware loops every field, accumulates *all* failures (not
fail-fast, so the client sees every problem at once), and either sends one `400`
with the `errors` array or calls `next()`.

**Why hand-rolled instead of Joi / Zod / express-validator?**

- **Pro:** zero dependencies, ~40 lines, trivial to read, and it produces
  errors in the project's own `ResponseFormatter` shape.
- **Con:** it is *minimal*. It has no type checking, no `maxLength`, no email /
  URL / pattern rules, no nested-object or array validation, no coercion, no
  "unknown field" rejection. A real project usually reaches for a library once
  the schemas get non-trivial — but for three tiny auth schemas this is fine and
  clear.

---

## The two-layer validation split (important, and slightly leaky)

There are **two** places that validate a password, and they disagree:

| | `validate(schema)` (request gate) | Mongoose `User` schema (`save()`) |
|---|---|---|
| min length | 6 | 6 (schema) **and** 8 (`SecurityUtils`) |
| uppercase / lowercase / number / symbol | not checked | checked by `SecurityUtils.validatePassword` |
| email **format** | not checked (only presence) | checked by the `email` field regex |
| runs | before any DB work | during `user.save()`, deep in the repository |

So a password like `abcdef` **passes** `validate()` (present, ≥6 chars), reaches
`userRepository.create()`, and **fails** at `user.save()` with a Mongoose
`ValidationError`. `errorHandler` catches that, maps it to `400`, and returns
`SecurityUtils`'s specific messages. The end result the client sees is
reasonable — but the check that *should* be at the door happens two layers
deeper than expected, and the two layers enforce different minimums (6 vs 8).

**The fix** (not done): have `validate` call `SecurityUtils.validatePassword`
for password fields, and add an email-format rule, so the request gate and the
model agree. Then the model's validation becomes a backstop, not the primary
check.
