# 1 · The startup bug fixes (`a0b0c11`)

**Mental model:** every one of these was a wall the process hit before it could
serve a single request. Six edits, and it boots.

---

| File | Change | Was blocking |
|---|---|---|
| `shared/config/logger.js` | `winston.combine(...)` → `winston.format.combine(...)` | not a function — the non-prod console transport threw on every dev run |
| `shared/config/mongodb.js` | `this.connection = mongoose.connection` after `connect()`; `"Disconnected"` → `"disconnected"`; `export default new MongoConnection()` | the module was unusable — attached listeners to `null`, listened for an event Mongoose never emits, exported the class not a singleton |
| `src/server.js` | `+ import cors from "cors"` | `app.use(cors())` threw `ReferenceError` at module load — the server couldn't start at all |
| `scripts/init.postgress.sql` → `scripts/init.postgres.sql` | `git mv` | the compose bind mount pointed at the single-"s" name; the script never ran |
| `shared/config/postgres.js` | `logger.info("...", value)` → template literal | the extra positional arg wasn't reliably landing in the rendered log line |
| `shared/config/rabbitmq.js` | same template-literal fix ×3 | same |

Also: `.gitignore` gains `logs`; `server/Dockerfile` gets a one-line stub
`FROM node-alpine` (not a valid tag — superseded in `40eb9b7`).

**What it does now.** `npm run dev` runs `initializeConnection()` to completion
and reaches `app.listen`. Before this commit it crashed at import (`cors`), or at
the first non-prod log (`winston.combine`), or on the first Mongo call.

**Why only these.** The commit is scoped to "make it start". Bugs that don't
block boot were left: `errorHandler` reading `req.statusCode`, the double
`dotenv.config()`, the `jwt.sercet` typo, `node_env: "Development "`,
`rabbitmq.getStatus()` reading `this.connect`. All still open — see
[../OPEN-ISSUES.md](../OPEN-ISSUES.md).
