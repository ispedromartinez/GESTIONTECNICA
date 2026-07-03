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

`server.js` is a 1700-line monolith that handles TIGO/WOM informe generation directly (POST `/generar`, POST `/generar-wom`, and all their `/registro*`, `/descargar*`, `/papelera*` variants). It also serves static HTML pages and mounts four extracted routers:

| Mount | Router | Handles |
|-------|--------|---------|
| `/auth` | `routes/auth.js` | Login, usuarios, superadmin setup |
| `/api/gestion` | `routes/gestion.js` | Gestión de empresas/áreas (admin ops) |
| `/api` | `routes/empresas.js` | Empresas CRUD, reset password |
| `/tareas` | `routes/preventivo.js` | Mantenimiento preventivo (CRUD, importar, exportar) |

Frontend pages are vanilla HTML/JS files in the project root, served by `express.static(__dirname)`. Each page has an inline JWT fetch interceptor that appends `Authorization: Bearer <token>` to every request automatically.

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

1. Frontend collects form data + photos as base64 data-URLs
2. POST `/generar` (or `/generar-wom`) receives JSON body (up to 80 MB)
3. `buildDocx(data)` builds a Buffer using the `docx` library (OpenXML)
4. File saved to `informes/` locally and uploaded to Supabase Storage
5. Metadata entry saved to DB, then the Buffer is streamed back as the download response

`codInforme` is the primary user-visible identifier (e.g. `YG0806ANTONITX01`). It is used as part of the filename and is **not sanitized** before being embedded in HTML attributes — escape it before innerHTML interpolation.

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
