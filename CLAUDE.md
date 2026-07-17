# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # node server.js — listens on port 3000
pm2 start ecosystem.config.js   # production with auto-reload
```

No test runner, no linter configured. Verify changes by restarting the server and hitting the affected endpoint with curl or the browser.

To create the first superadmin after a fresh deploy:
```bash
curl -X POST http://localhost:3000/auth/register-superadmin \
  -H "Content-Type: application/json" \
  -d '{"nombre":"...", "email":"...", "password":"...", "secret":"<ADMIN_SECRET>"}'
```

## Architecture

`server.js` is now a thin bootstrap (~1050 lines, down from ~1700): it wires up middleware, serves static HTML pages, and mounts six extracted routers. TIGO and WOM informe generation (`POST /generar`/`/generar-wom` and all `/registro*`, `/descargar*`, `/papelera*` variants) were extracted from inline server.js code into dedicated routers on 2026-07-17 — Preventivo's own informe generation (`/generar-preventivo`, `/registro-prev`, etc.) is the one remaining inline holdout, still living in `server.js` (a natural next extraction, same pattern).

| Mount | Router | Handles |
|-------|--------|---------|
| `/auth` | `routes/auth.js` | Login, usuarios, superadmin setup |
| `/api/gestion` | `routes/gestion.js` | Gestión de empresas/áreas (admin ops) |
| `/api` | `routes/empresas.js` | Empresas CRUD, reset password |
| `/tareas` | `routes/preventivo.js` | Mantenimiento preventivo (CRUD, importar, exportar) |
| *(no prefix)* | `routes/tigo.js` | Informes TIGO/Clima: generar, registro, descargar, papelera |
| *(no prefix)* | `routes/wom.js` | Informes WOM: generar, registro, descargar, papelera |

`routes/tigo.js` and `routes/wom.js` follow the same self-contained shape as `routes/preventivo.js` (mappers + storage-duality DB helpers + routes in one file, no separate `db/*.js`) — each attaches its list-fetching function to the exported router (`router.dbClimaList`/`router.dbWomList`) so the four cross-module composition endpoints that stay in `server.js` (`/api/dashboard`, `/api/reportes`, `/api/equipos/:id/historial`, `/api/equipos/backfill`) can still reach them without duplicating the DB layer. Helpers shared by TIGO, WOM, **and** the still-inline Preventivo generation code (`sanitizeSearch`, `escapeLike`, `filtrarInformesPorEmpresa`, `puedeVerInforme`, `vincularInformeGestion`, `storageUpload/Download/Move/Remove`, `loadTareasInformes`/`saveTareasInformes`) live in `utils/informesCompartido.js` — a new shared module, not duplicated per-router, for the same reason `common.js` centralizes `esc`/`escArg` (see the XSS-drift note below).

Frontend pages are vanilla HTML/JS files in the project root, served by `express.static(__dirname)`. Most pages define a local `authH()` helper that must be spread into every `fetch(...)` call manually; `informe-preventivo.html` is the one page that instead monkey-patches `window.fetch` globally at the top of its `<script>` — these are two different mechanisms, not one shared interceptor, despite doing the same job.

## Storage duality

Every data layer has two backends selected at startup:

```js
const supabase = (SUPABASE_URL && SUPABASE_KEY && USE_LOCAL_DB !== 'true')
  ? createClient(...) : null;
```

- **Supabase present** → PostgreSQL tables + Storage bucket `documentos-word`
- **Supabase absent** → JSON files (`registro.json`, `papelera.json`, `tareas_preventivo.json`) + local `informes/` directory

All DB helpers follow the pattern `if (supabase) { /* Supabase path */ } else { /* JSON path */ }`. When adding fields, update both paths AND the `fromX`/`toX` row mapper pair that translates camelCase ↔ snake_case for Supabase.

`tareas_informes.json` (root) maps `tareaId → {informeId, filename}` — written on POST `/generar` when `tareaId` is present, read by GET `/tareas/informes-map`. This file is not gitignored and should be added to `.gitignore`.

## Auth & multi-tenancy

JWT payload carries `{ usuario_id, rol, empresa_id, areas_permitidas }`. All protected routes run through `middleware/auth.js` (validates token) → optional `middleware/roles.js` (`requireRol` / `requireNivel`).

Role hierarchy (nivel): `superadmin(5) > admin_empresa(4) > encargado_clientes(3) > supervisor(2) > tecnico(1)`.

Data isolation is enforced in each route by filtering on `empresa_id` from `req.user`. Superadmin (`empresa_id === null`) sees all tenant data.

## Informe generation flow

Both TIGO and WOM follow the same pattern:

1. Frontend collects form data + photos as base64 data-URLs, compressed client-side (see below) before they ever enter the payload
2. POST `/generar` (or `/generar-wom`) receives JSON body (up to 80 MB)
3. `buildDocx(data)` builds a Buffer using the `docx` library (OpenXML) — invoked from `routes/tigo.js`/`routes/wom.js`, not `server.js`
4. File saved to `informes/` locally and uploaded to Supabase Storage
5. Metadata entry saved to DB, then the Buffer is streamed back as the download response

`codInforme` is the primary user-visible identifier (e.g. `YG0806ANTONITX01`). It is used as part of the filename and is **not sanitized** before being embedded in HTML attributes — escape it before innerHTML interpolation.

## Photo compression & offline resilience (frontend, 2026-07-17)

The three informe pages (`informe_clima_app.html`, `informe_wom_app.html`, `informe-preventivo.html`) share two new pieces of infrastructure added to **`common.js`** — same rationale as `esc`/`escArg`: one implementation, not three copies that can drift.

- **`comprimirImagenDataURL(dataUrl, maxDim=1600, calidad=0.85)`** — takes the raw `FileReader.readAsDataURL` result and re-encodes it (canvas resize + JPEG) if it exceeds `maxDim` on either edge. Called at photo-*capture* time (`loadPhotoFile` in TIGO, `addFiles` in WOM, `loadPhotoFileP` in Preventivo), not just at submit time — the docx/PDF only embeds photos at ~210-235px wide (`docx/clima.js`, `docx/wom.js`), so 1600px is already generous headroom. TIGO previously had a submit-time resize function (`getPhotoForExport`) that was **dead code** — the payload sent the raw uncompressed `photoDataUrls` — that's now wired in, matching what WOM/Preventivo already did.
- **IndexedDB module** (`informes_offline` DB, two stores): `guardarBorrador`/`cargarBorrador`/`borrarBorrador` (one autosaved draft per page, replaces WOM's old `localStorage`-only draft — TIGO and Preventivo didn't have autosave at all before) and `encolarPendiente`/`listarPendientes`/`borrarPendiente`/`reintentarPendientes`/`iniciarSincronizacionOffline` (a retry queue for submissions that fail due to lost connectivity). The app can't generate the .docx/PDF client-side (`buildDocx`/`buildDocxWom`/`buildPdfPreventivo` are server-only), so this is deliberately *not* a PWA/service-worker — no manifest.json, no offline app-shell caching, no background sync. The page must already be open before signal drops; retries only run while a tab with this code is open (`online` event + a 20s interval + one attempt on load).
- **Failure-mode split, every submit handler**: the `fetch(...)` call itself is wrapped separately from the `!resp.ok` check. If `fetch` throws (no response reached — genuine connectivity loss), the payload goes into the `pendientes` queue and the user sees "guardado, se enviará cuando vuelva la señal" instead of an error. If the server *responds* with a non-2xx (validation, auth, etc.), nothing is queued — retrying an identical rejected request wouldn't help. On retry, a 401/403 leaves the item queued (a fresh login refreshes the token the next attempt reads); any other non-2xx marks the item with `ultimoError` so the 20s loop stops hammering it until the next full page load.
- TIGO had a pre-existing `checkServer()`/`serverOnline` pre-flight `/ping` check that used to **block** `generateDocx()` entirely with a "servidor no activo" message before the fetch ever ran — that would have silently defeated the new queueing (never reaching the try/catch). It's now purely informational (still updates the badge); the fetch itself decides.
- Known asymmetry preserved on purpose: WOM's `/generar-wom` still doesn't link `tareaId` → `tareas_informes.json` the way TIGO's `/generar` does, and there's still no `POST /enviar-wom/:id` — out of scope for this change.

## Security rule: escape all server data before innerHTML (MANDATORY)

Any page that renders server-supplied data (informe fields, empresa/usuario
names, sitios, técnicos, etc.) into `innerHTML`/`insertAdjacentHTML`/template
literals **MUST** run it through `esc()` first, and through `escArg()` inside
inline `onclick="..."` handlers. The JWT lives in `localStorage`, so an
unescaped field is stored-XSS → token theft → privilege escalation across the
tenant.

- Canonical helpers live in **`common.js`** (single source, loaded by every
  page before its own `<script>`):
  - `esc(s)` — escapes `& < > " '` for HTML/attribute contexts.
  - `escArg(s)` — `esc()` plus backslash/quote escaping for JS string args.
- Helpers are now **shared** (no longer per-page): a new module page only needs
  to include `common.js`. Earlier each page had its own copy and the drift
  caused an XSS (WOM lacked them).
- **Trap — inside `onclick="f('${...}')"` use `escArg()`, NOT `esc()`.** `esc()`
  encodes `'` as `&#39;`, which the HTML parser decodes back to `'` before the JS
  engine reads the attribute — breaking out of the string literal. `escArg()`
  backslash-escapes it so it stays inert. Text/attribute contexts keep `esc()`.
- Fixed in WOM history on 2026-07-13 (commit `7f89cd0`); centralized to
  `common.js`; onclick `esc→escArg` fix on 2026-07-15 (commit `23c5503`).

## Equipos (hoja de vida)

`db/equipos.js` mantiene la tabla resumen `equipos` (clave natural empresa+sitio+numero,
normalizada con `claveEquipo`). Se puebla con upsert automático (no bloqueante) en
POST `/generar` y `/generar-wom`; el historial se consulta en vivo contra los registros
de informes usando las columnas `eq_numero` (clima) y `equipo` (wom).
API: GET `/api/equipos`, GET `/api/equipos/:id/historial`, POST `/api/equipos/backfill`
(superadmin). UI: pestaña Equipos en `catalogo.html`.

## Preventivo module

`routes/preventivo.js` manages `tareas_preventivo` (Supabase table or `tareas_preventivo.json`). The `fromTarea`/`toTarea` mapper translates the camelCase app model to snake_case Supabase columns. When the XLSX import route (`POST /tareas/importar`) runs, `TAREAS_COLUMNAS` defines the header labels; `TAREAS_COLUMNAS_INV` is the reverse map built from it.

## Key env vars

```
PORT            default 3000
JWT_SECRET      required in production
SUPABASE_URL    optional — omit to use local JSON
SUPABASE_KEY    service role key
SUPABASE_BUCKET documentos-word
USE_LOCAL_DB    true → forces JSON fallback even if Supabase vars are set
ADMIN_SECRET    one-time secret for /auth/register-superadmin
```

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
