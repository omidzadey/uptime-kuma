# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository context

This is a **fork** of Uptime Kuma. Upstream's `AGENTS.md` forbids AI-generated PRs to the public project — those rules apply to upstream contributions, not local work on this fork. Do not attempt to open upstream PRs from here.

Stack: Vue 3 + Node/Express + Socket.IO + redbean-node (SQLite by default, also MariaDB/MySQL). Node >= 20.4. npm with `legacy-peer-deps=true`.

## Commands

```bash
npm ci                 # install (use ci, not install)
npm run dev            # frontend :3000 + backend :3001 (concurrently)
npm run lint           # eslint + stylelint — run before committing
npm run lint-fix:js    # autofix JS/Vue
npm run build          # vite build → dist/
npm run test-backend   # node:test runner via test/test-backend.mjs
npm run test-e2e       # Playwright (needs `npx playwright install` once)
```

Run a single backend test file:
```bash
cross-env TEST_BACKEND=1 node --test --test-reporter=spec test/backend-test/test-<name>.js
```

Inspect the live SQLite DB while dev server is stopped:
```bash
sqlite3 data/kuma.db "<query>"
```

Code style is strictly enforced: 4-space indent, double quotes, LF, semicolons, JSDoc on functions/methods. JS/TS uses camelCase, SQLite columns use snake_case, CSS/SCSS kebab-case. `npm run tsc` reports ~1400 pre-existing errors — ignore them, they don't affect builds.

## Architecture — the parts that aren't obvious from `ls`

### Socket.IO-first backend

`server/server.js` (~2000 lines) registers almost all client-facing operations as `socket.on("name", async (..., callback) => { ... })` handlers. Express routers in `server/routers/` are limited to `api-router.js` (REST, mostly for badges/metrics) and `status-page-router.js` (public status pages). Large logical groupings live in `server/socket-handlers/` (chart, database, docker, maintenance, proxy, remote-browser, status-page, cloudflared, api-key, general) — these are invoked from `server.js`.

The canonical pattern for a new client-callable op:

1. `socket.on("opName", async (args..., callback) => { try { checkLogin(socket); ...; callback({ ok: true, data }); } catch (e) { callback({ ok: false, msg: e.message }); } })` in `server.js` (or a socket-handler module).
2. Thin wrapper in `src/mixins/socket.js`: `opName(args..., callback) { socket.emit("opName", args..., callback); }`.
3. Vue components call `this.$root.opName(args, cb)`.

### `$root` is the socket hub

`src/main.js` mixes `src/mixins/socket.js` into the root app. All socket ops are on `$root`, **and** the reactive state pushed from the server (`$root.monitorList`, `$root.heartbeatList`, `$root.avgPingList`, `$root.uptimeList`, `$root.maintenanceList`, etc.) lives there too. Components should watch these rather than polling. `heartbeatList[monitorID]` is a rolling array capped at 150 — the server emits a `heartbeat` event per check.

### Monitor types are plugins

Each type is a subclass of `server/monitor-types/monitor-type.js` with:

```js
async check(monitor, heartbeat, server) { /* set heartbeat.status=UP + heartbeat.msg, or throw */ }
```

- Success = `heartbeat.status = UP` (`src/util.ts` exports `UP=1, DOWN=0, PENDING=2, MAINTENANCE=3`) plus a human-readable `heartbeat.msg`.
- Failure = `throw new Error("...")`. The thrown message becomes `heartbeat.msg` in the dispatcher's catch path.
- Register the type in `server/uptime-kuma-server.js` under `UptimeKumaServer.monitorTypeList["<name>"]`. The scheduler in `server/model/monitor.js` `beat()` dispatches through that map automatically. **Do not** add per-type scheduling, retry, or heartbeat persistence — the scheduler handles all of it via `monitor.interval`, `monitor.maxretries`, `monitor.retryInterval`.
- `allowCustomStatus = true` on the subclass lets `check()` set `heartbeat.status = DOWN` directly and return instead of throwing. The default (`false`) requires throwing for DOWN.
- `supportsConditions` opts into the generic conditions engine.

Gotchas that aren't in the code comments:

- **Heartbeat bean mutations pre-throw survive.** Anything you set on `heartbeat` before `throw` is still persisted by `R.store(bean)` in the scheduler's catch path, so you can stash JSON diagnostics on a DOWN path. `heartbeat.msg` is overwritten with `error.message` in the catch, so user-facing text must live on the thrown Error.
- **The *monitor* bean is NOT re-stored by `beat()`.** If you mutate `monitor.<field>` inside `check()`, it won't hit the DB unless you call `R.store(monitor)` explicitly. That call can race with the scheduler and fail silently. Prefer storing per-check state on the heartbeat row and fetching from there in the frontend.

### Database access (redbean-node)

`R.store(bean)`, `R.getAll("SELECT ...")`, `R.findOne("monitor", "id = ?", [id])`. Beans auto-map camelCase ↔ snake_case column names, so a column `stremio_manifest_url` is reached as `bean.stremio_manifest_url`.

Schema:
- Initial tables in `db/knex_init_db.js` — **do not add new columns here**. The file header explicitly forbids it.
- All schema changes go in `db/knex_migrations/` as Knex migration files named `YYYY-MM-DD-NNNN-description.js`. Filenames are CI-validated by `extra/check-knex-filenames.mjs`.
- Primary DB is SQLite at `data/kuma.db` (+ `-shm`/`-wal`). MariaDB/MySQL is also supported. `data/db-config.json` picks the dialect.

### Monitor field round-trip

A new column on the `monitor` table needs edits in **four** places or the field will silently disappear from the UI:

1. Migration in `db/knex_migrations/`.
2. `toJSON()` in `server/model/monitor.js` (~L117) — frontend receives only what's listed here.
3. `editMonitor` socket handler in `server/server.js` — explicitly copies fields per-column. The `add` handler uses `bean.import(monitor)` which is automatic, but `editMonitor` is NOT automatic.
4. `src/pages/EditMonitor.vue` — add to `monitorDefaults[<type>]` and render a `v-if="monitor.type === '...'"` form block. Plus an `<option>` in the type dropdown.

If the field should show on the details page, also edit `src/pages/Details.vue` — it has per-type `v-if` blocks near the top for header strings and dedicated panels lower down.

### i18n

Only edit `src/lang/en.json`. Other language files are Weblate-managed. Use `$t("Key")` in Vue templates. Keys are bare strings, not dotted namespaces.

### Notification providers

Same plugin pattern as monitors, in `server/notification-providers/`. Register in `server/notification.js`. Frontend components in `src/components/notifications/` + register in `src/components/notifications/index.js` + add to `src/components/NotificationDialog.vue`. Add i18n keys.

### Frontend build

Vite config is at `config/vite.config.js` (not project root). The dev server proxies socket.io to :3001. Bootstrap 5 is the UI framework — use `.shadow-box`, `.big-padding`, `.form-control`, `.btn btn-primary`, etc. rather than writing new CSS. `vue-multiselect` is already a dep for async search inputs. Modals use Bootstrap's JS `Modal` class with `ref="modal"` + `this.modal = new Modal(this.$refs.modal)` + `show()/hide()` — see `src/components/ScreenshotDialog.vue` for the minimal pattern.

### Testing

`test/test-backend.mjs` runs `node --test` over `test/backend-test/**/*.js` with `TEST_BACKEND=1`. Tests are `node:test` style (`describe`, `test`, `beforeEach`). Database-touching code should stub `R.store` (see `test/backend-test/test-stremio-addon-monitor.js` for the pattern). E2E is Playwright in `test/e2e/` with config at `config/playwright.config.js`; it needs a built `dist/`.

### Data directory

`data/` is gitignored and holds runtime state: `kuma.db` (SQLite), `db-config.json` (dialect + connection), `screenshots/` (real-browser monitors), `upload/`. Nuking `data/` resets the install to first-run setup wizard. `data/playwright-test/` is used by E2E.

## Fork-specific additions

- **Stremio Addon monitor type**: `server/monitor-types/stremio-addon.js` + helpers in `server/stremio/{client.js,cinemeta.js}`. The monitor auto-detects stream vs catalog strategy from the addon manifest and pulls fresh random IMDb IDs from Cinemeta's top catalogs each check.
- **Stremio UI**: `src/components/StremioCheckDetails.vue` (the card on Details.vue) + `src/components/StremioHistoryModal.vue` (the history popup). The card reads raw check data from `heartbeat.stremio_data` via the `getStremioHistory` socket handler — it auto-reloads on new heartbeats by watching `$root.heartbeatList[monitor.id]`, with a 30s poll as fallback.
- **Stremio-addons.net search** on the New Monitor form is a direct browser-side fetch (CORS is permissive on `stremio-addons.net/api/v0/addons`). Helper: `src/util-frontend-stremio-addons-hub.js`.
- **Migrations added**: `db/knex_migrations/2026-04-14-0000-add-stremio-addon-monitor.js` adds `monitor.stremio_manifest_url`, `monitor.stremio_last_check`, `heartbeat.stremio_data`. Note: `stremio_last_check` is not reliably populated (R.store-on-monitor race) — the UI reads from `heartbeat.stremio_data` instead.

## Things that waste time if you don't know them

- Ports 3000/3001 collide with other dev servers — kill anything squatting before `npm run dev`.
- First run shows "db-config.json not found" in the backend log — that's the setup wizard, not an error.
- `npm run tsc` is noise; don't try to "fix" its errors.
- Stylelint emits deprecation warnings; they're expected.
- `@louislam/sqlite3` native binding can be missing after a fresh pnpm/npm install. Fix: `cd node_modules/.pnpm/@louislam+sqlite3@*/node_modules/@louislam/sqlite3 && npx @mapbox/node-pre-gyp install --fallback-to-build`.
- Adding a frontend-visible field but forgetting to list it in `monitor.js` `toJSON()` → silent failure, field is `undefined` on `this.monitor`.
- `git log` on upstream history is long and noisy; `git log master --first-parent` keeps merges clean.
