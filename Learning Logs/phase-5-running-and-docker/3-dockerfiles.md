# 3 · `Dockerfile` and `Dockerfile.consumer` (`40eb9b7`)

**Mental model:** two near-identical images, one per process. They differ in one
line — the `CMD`.

---

**What we did.** `a0b0c11` left `server/Dockerfile` as `FROM node-alpine` — not
a valid image reference, so it wouldn't build. This commit writes both properly.

`Dockerfile`:

```
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p logs
EXPOSE 5000
CMD ["node", "src/server.js"]
```

`Dockerfile.consumer` is identical except `CMD ["node", "src/consumer.js"]` and a
comment that the file doesn't exist yet.

**What it does.** `docker build` produces a Node-18-on-Alpine image with
production dependencies only, source copied in, a `logs/` dir pre-created, port
5000 documented, and the API process as the default command.

**Why each line:**

- **`node:18-alpine`** — Alpine for a small image; a pinned major for
  reproducibility. (It's *18*, while local dev runs Node 24, and Node 18 is
  end-of-life — Issue.)
- **`COPY package*.json` → `RUN npm install` → `COPY . .`** — the build-cache
  order: dependencies change rarely, source constantly. Copy the manifests and
  install first, and the expensive `npm install` layer stays cached through
  every source-only edit.
- **`npm install --production`** — skip devDependencies (`nodemon`); the image
  doesn't need the file-watcher. (Deprecated spelling of `--omit=dev`; still
  works, warns.)
- **`RUN mkdir -p logs`** — belt-and-braces; the compose service also bind-mounts
  `./logs` (which shadows this), but a bare `docker run` wouldn't.
- **`EXPOSE 5000`** — documentation only; it matches the `PORT: 5000` compose
  injects.
- **`CMD ["node", "src/server.js"]`** — **exec form**, so the Node process is
  PID 1 and receives `SIGTERM` directly — which is what the Phase 4
  graceful-shutdown handler needs.

**The two-image split, realised.** Phase 1 committed to two Dockerfiles "because
they are two processes". They're near-identical — a shared base image is the
obvious later refactor. What the split buys: API and (future) worker are
independently buildable and scalable, sharing only the repo.
