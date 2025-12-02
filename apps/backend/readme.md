# apps/backend — Quick Start & Troubleshooting

This README is a compact, actionable checklist for building, running, and debugging the backend package in this monorepo. Keep steps small and reproducible.

---

## Quick facts

* Built output (current): `apps/backend/dist/*.js` (compiled JS files are emitted directly under `apps/backend/dist`).
* Runtime helper: `apps/backend/scripts/node-start.js` — uses `tsconfig-paths` to map runtime aliases and explicitly starts the server and workers.
* Local dev port: `3000` by default.

---

## Build (one command)

Use the package-local tsconfig to compile the backend:

```bash
# from repo root
rm -rf apps/backend/dist
npx tsc --project apps/backend/tsconfig.json
```

Expected artifacts after a successful compile (examples):

```
apps/backend/dist/server.js
apps/backend/dist/db.js
apps/backend/dist/worker.js
apps/backend/dist/sync.worker.js
apps/backend/dist/types.js
```

---

## Run (development / local)

Start the compiled backend (this script ensures the server listens even when required):

```bash
node apps/backend/scripts/node-start.js
```

What this does:

* Loads environment from repo `.env`
* Registers `tsconfig-paths` with runtime mappings to compiled files
* Requires compiled `apps/backend/dist/server.js`
* Calls `app.listen(...)` if compiled export provides an Express app
* Attempts to start `worker.js` and `sync.worker.js` if present (fail-safe)

---

## Quick health checks

Once started:

```bash
curl -i http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3000/api/v1/kore/health
```

---

## Why we use a package-local tsconfig

The monorepo root tsconfig runs in `bundler` mode and `noEmit: true` for frontend tooling. The backend needs predictable `outDir` and `moduleResolution` behavior — keep `apps/backend/tsconfig.json` independent (no `extends`).

Key settings to preserve in `apps/backend/tsconfig.json`:

* `moduleResolution: "node"`
* `module: "CommonJS"` (or a deliberate ESM migration strategy)
* `rootDir: "./src"` and `outDir: "./dist"`

---

## Troubleshooting checklist (small steps)

1. **Missing compiled entry**: `apps/backend/dist/server.js` must exist. If not, run the build command above and inspect `tsc` output.

2. **`require.main === module` guard prevents server from listening**: `node-start.js` explicitly calls `app.listen(...)`. If you run `node dist/server.js` directly, the original module-level listener will be used.

3. **Path alias runtime resolution**: `node-start.js` registers `tsconfig-paths` with base set to `apps/backend/dist`. If your build emits under `dist/src`, update `baseUrl` mapping accordingly or change `rootDir` in `apps/backend/tsconfig.json`.

4. **ESM vs CJS mismatches**: Prefer `module: "CommonJS"` for immediate stability. If migrating to ESM, set `"type": "module"` in `apps/backend/package.json` and ensure `.js` extensions are present in imports.

5. **Workers crash server**: Worker imports are loaded lazily. Check `worker.js` and `sync.worker.js` exports for `startWorker` / `startSyncWorker` functions.

6. **CI / PR safety**: Add a CI step to compile backend and verify `apps/backend/dist/server.js` exists before merging.

---

## Suggested CI snippet (GitHub Actions)

Paste into your workflow to block merges that break the backend emit:

```yaml
- name: Build backend
  run: npx tsc --project apps/backend/tsconfig.json

- name: Ensure backend entry exists
  run: test -f apps/backend/dist/server.js
```

---

## Quick commands reference

* Build: `npx tsc --project apps/backend/tsconfig.json`
* Run: `node apps/backend/scripts/node-start.js`
* Check health: `curl http://127.0.0.1:3000/health`

---

If you want, I can also create:

* A one-file troubleshooting script that runs the build, lists `dist`, and attempts a dry require.
* A GitHub Actions workflow file ready to paste.

Tell me which of those tiny tasks you'd like next.
