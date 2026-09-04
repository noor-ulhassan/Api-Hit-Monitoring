# LinkedIn post — API Hit Monitoring, current state

## The post caption (body text)

Most backend tutorials stop at CRUD. I wanted to know what actually changes when you design for production load instead — so that's what I've been building for my final year project: a self-hosted API hit monitoring system, architected the way a real observability tool would be, not a demo.

A quick look at where it stands, and the reasoning behind it:

The ingest path doesn't write to a database on every request. It publishes to a message queue instead, so a traffic spike becomes a queue depth problem, not a database outage. A separate worker drains that queue, with a dead-letter queue catching anything that fails instead of silently dropping it.

The data itself lives in two different databases, on purpose. Accounts and API keys are relational and need to stay correct. Raw traffic events are a high-volume stream that's mostly read as aggregates. One engine being great at both isn't realistic, so I split them, and pre-aggregate the analytics into their own rollup table instead of scanning raw events on every dashboard load.

The backend follows a layered architecture — router, controller, service, repository — each with one job, each only allowed to call the layer below it. The service layer holds every business rule and never touches HTTP. The repository is the only file allowed to talk to the database. That split is what makes a rule like "only one super admin can ever exist" testable with a fake database in a few lines, instead of needing a running server.

None of this is finished. It's an ongoing build, and I'm documenting every decision as I go, including a running list of open issues and shortcuts I haven't gotten to yet. I'd rather show the real state of something than a polished lie.

Swipe through for the architecture, the layering, and what's next.

---

## Slide-by-slide plan (carousel)

**Slide 1 — hook.** Big text, no logo yet.
"Most backend projects stop at CRUD. Here's what changes when you build for production load instead."

**Slide 2 — what it is.**
"API Hit Monitoring — a self-hosted service that tracks every API call your backend makes: endpoint, latency, status, errors — and turns it into analytics."

**Slide 3 — the architecture diagram.**
Use the system architecture diagram (producer → queue → consumer → two databases).
Caption: "The ingest path never writes to a database directly. It publishes to a queue. A separate worker drains it. A traffic spike doesn't become a database outage."

**Slide 4 — comparison.**
Two columns, one line each:
- Write to the database on every request → Publish to a queue, write asynchronously
- One database for everything → Two databases, each doing the job it's actually good at
- One handler does everything → Layered: router, controller, service, repository
- Errors handled differently per route → One central error handler, one response shape everywhere

**Slide 5 — the layered architecture diagram.**
Use the simplified version: Router → Controller → Service → Repository → Model, one arrow down, one arrow back up. Leave the middleware plumbing out of this one — it's not the point.
Caption: "Each layer only calls the one below it. Controller never queries the database. Service never touches the request or response. Repository is the only file that knows what a database is."

**Slide 6 — proof of work.**
Screenshot: the whole stack — API, MongoDB, PostgreSQL, RabbitMQ — starting up healthy from one command.
Caption: "Real, not staged."

**Slide 7 — engineering discipline.**
Screenshot: your open-issues ledger (blur or crop out anything too raw if needed).
Caption: "I keep a running list of every known bug and shortcut. Knowing exactly what's not done yet is part of the job."

**Slide 8 — what's next, and the close.**
"Still ahead: the worker that drains the queue, the analytics endpoints, hardening auth. This is a build in progress — I'm documenting it as I go and will keep sharing updates."

---

## Notes

- Keep the tone as "here's my reasoning," not "here's how good I am." The trade-off explanations are what make this read as engineering judgment instead of a feature list.
- Don't state specific unfixed bugs publicly (e.g. don't say "four routes are broken right now") — "still ahead" / "hardening in progress" covers it honestly without handing anyone a bug list.
- First two lines of the caption are what shows before LinkedIn truncates with "see more" — the hook above is written to stand alone if that's all someone reads.
- Swap in your actual project name once you've settled on one; every mention above is written to drop in cleanly.
