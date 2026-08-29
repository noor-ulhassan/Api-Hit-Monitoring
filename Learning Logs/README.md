# Learning Logs

A running record of how the **API Hit Monitoring** application is built: every
change, every decision, every tool, and the reasoning behind them. The goal is
that on any future day you can open one file, read for a few minutes, and have
the full mental model back.

## How this folder works

- One numbered log file per phase of work. Files are append-friendly reference
  documents, not diary entries. When a phase is done, its file should stand on
  its own.
- Each file follows the same shape:
  1. **Scope** - what this phase covers.
  2. **Context** - why we are doing it now, what it unblocks.
  3. **Concepts** - the system-design / full-stack ideas introduced, explained
     from first principles.
  4. **Walkthrough** - what each file does and, more importantly, *why it was
     done that way*: the decision, the alternative that was rejected, and the
     trade-off accepted. Code is quoted only in small snippets where the code
     itself is the lesson (a pattern, a gotcha, an API shape). Otherwise the
     file is referenced as `path/to/file.js:line` and described in prose - the
     code is in git, the reasoning is not.
  5. **Issues and TODO** - known bugs, shortcuts, and things to revisit. This
     section is deliberately blunt so nothing is silently forgotten.
  6. **Commit history** - the git commits that belong to this phase.
  7. **Glossary** - terms used, defined once.
- When something built earlier turns out to be wrong, do not rewrite history.
  Add a dated correction note to the relevant file and, if useful, a line in the
  newer log explaining what changed and why.

## Index

| File | Phase | Status |
|------|-------|--------|
| `01-foundations-infrastructure-and-config.md` | Project concept, architecture, local infrastructure (Docker Compose), configuration layer, structured logging, database and message-queue connection modules | Complete up to commit `1d2f210` |
| `02-data-models-and-security-utils.md` | The data layer: four Mongoose schemas (`User`, `Client`, `ApiKey`, `ApiHits`) and the standalone password-policy class; hashing lifecycle, index strategy, TTL expiry, the abandoned PostgreSQL plan | Complete up to commit `96ab4e2` |
| `03-response-envelope-and-error-handling.md` | The HTTP contract: `AppError` (status code + operational-vs-bug flag on the thrown error) and `ResponseFormatter` (one JSON envelope for success / error / validation / paginated replies), both built before the first route | Complete up to commit `1b49f97` |
| `04-server-bootstrap-and-analytics-rollup.md` | `server.js` rewritten from stub to real bootstrap (middleware stack, `/` + `/health`, connect-before-listen, graceful shutdown, process safety nets); the Express error middleware; and `endpoint_metrics`, the PostgreSQL pre-aggregation rollup table | Working tree on top of `1cb8f56`; not yet committed |

## Conventions used across logs

- Code references are written as `path/to/file.js:lineNumber`.
- "Producer" = the HTTP API process that receives traffic. "Consumer" =
  the background worker process that drains the queue and writes to storage.
- Commands assume you are in the `server/` directory unless stated otherwise.
