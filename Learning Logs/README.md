# Learning Logs

A running record of how the **API Hit Monitoring** app is built: every change,
every decision, and the reasoning behind them. The goal: on any future day, open
one file, read for a few minutes, and have the full mental model back.

---

## Start here

| File | What it gives you |
|---|---|
| **[THE-MAP.md](THE-MAP.md)** | The whole app on one page: architecture diagram, every file annotated, the layer model, the build timeline, what runs vs what is dead. **Read this first, and whenever you come back after a break.** |
| **[GLOSSARY.md](GLOSSARY.md)** | Every term used in the logs, defined once. |
| **[OPEN-ISSUES.md](OPEN-ISSUES.md)** | The live ledger of every known bug / shortcut / TODO across all phases, with status (open / fixed in phase N). |

---

## The phases

Each phase is a folder. Its `README.md` is a one-screen overview (scope, state,
file map, the gist, issues opened). Numbered files inside go deep on one piece.

| Phase | Folder | In one line |
|---|---|---|
| 1 | [`phase-1-foundations/`](phase-1-foundations/) | Infra (Docker Compose), the config object, the logger, and the three DB/queue connection singletons |
| 2 | [`phase-2-data-models/`](phase-2-data-models/) | `SecurityUtil` + four Mongoose schemas: `User`, `Client`, `ApiKey`, `ApiHits` |
| 3 | [`phase-3-http-contract/`](phase-3-http-contract/) | `AppError` and `ResponseFormatter` — one error type, one response envelope, built before the first route |
| 4 | [`phase-4-server-bootstrap/`](phase-4-server-bootstrap/) | `server.js` becomes a real bootstrap; the error middleware; the `endpoint_metrics` rollup table |
| 5 | [`phase-5-running-and-docker/`](phase-5-running-and-docker/) | Fix the startup-blocking bugs; fill both Dockerfiles; add app + consumer services to compose |
| 6 | [`phase-6-layered-architecture/`](phase-6-layered-architecture/) | The Repository → Service → Controller → DI pattern, on the `auth` feature; auth middleware |

---

## How the logs are written

- **What we did / What it does / Why** for every file — the concrete change, its
  runtime behaviour, and the decision (with the rejected alternative and the
  trade-off).
- **No predicting the future.** The logs describe what exists. They do not guess
  how unbuilt features will look — earlier drafts did, and the guesses were
  wrong. Each phase ends with a factual "not yet built" list, not a roadmap.
- **Blunt about bugs.** Every shortcut and defect is written down in
  `OPEN-ISSUES.md` so nothing is silently forgotten.
- **Corrections, not rewrites.** When something earlier turns out wrong, a dated
  note is added where it was; history is left intact.
- Code references are `path/to/file.js:line`. "Producer" = the HTTP API process.
  "Consumer" = the (not-yet-built) queue worker.
