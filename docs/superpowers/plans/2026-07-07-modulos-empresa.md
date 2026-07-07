# Módulos por Empresa (Tigo/WOM/Preventivo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let superadmin decide which of the 3 fixed legacy modules (Tigo/WOM/Preventivo) each empresa can see and use, both in the dashboard UI and enforced server-side.

**Architecture:** Add 3 boolean columns to `empresas` (default enabled, so nothing breaks for existing data). Surface them through the existing empresa CRUD API and through `/auth/me`. Gate the 3 static dashboard tiles client-side using the `/auth/me` response already fetched on load. Gate the legacy Tigo/WOM/Preventivo route groups in `server.js` with a new `requireModulo()` middleware so URL/API bypass isn't possible.

**Tech Stack:** Node/Express, better-sqlite3 (local), Supabase/Postgres (optional remote), vanilla JS/HTML frontend. No test runner/linter configured — verification is via restarting the server and hitting endpoints with curl/browser (per project convention).

## Global Constraints

- No automated test framework exists in this repo — every task's "test" step is a manual curl/browser check against the running dev server, not a unit test file.
- Existing empresas must default to all 3 modules enabled (no regression for current customers).
- Module flags on an empresa are editable only by `superadmin` (same tier as `slug`/`activa`).
- Local (SQLite) and Supabase (Postgres) storage paths must both work per `db/gestion.js`'s existing pattern (`if (supa) {...} else {...}`), but this repo only runs the local path in dev — Supabase changes are additive SQL the user applies manually.

---

## Task 1: Add module columns to the `empresas` table (SQLite)

**Files:**
- Modify: `db/local.js:109-120` (migration block), `db/local.js:218-224` (`empresas.insert`), `db/local.js:226-232` (`empresas.update`)

**Interfaces:**
- Produces: `empresas` rows now carry `modulo_tigo`, `modulo_wom`, `modulo_preventivo` (INTEGER, default 1). `local.empresas.insert(e)` accepts optional `e.modulo_tigo`/`e.modulo_wom`/`e.modulo_preventivo` (0/1/boolean-ish); `local.empresas.update(id, f)` accepts the same 3 keys.

- [ ] **Step 1: Add the migration lines**

In `db/local.js`, right after line 114 (`try { db.exec("ALTER TABLE empresas ADD COLUMN direccion TEXT"); } catch {}`), add:

```js
// Módulos legacy fijos habilitados para la empresa (Tigo/WOM/Preventivo)
try { db.exec("ALTER TABLE empresas ADD COLUMN modulo_tigo INTEGER DEFAULT 1"); } catch {}
try { db.exec("ALTER TABLE empresas ADD COLUMN modulo_wom INTEGER DEFAULT 1"); } catch {}
try { db.exec("ALTER TABLE empresas ADD COLUMN modulo_preventivo INTEGER DEFAULT 1"); } catch {}
```

- [ ] **Step 2: Update `empresas.insert` to accept the 3 fields**

Replace the `insert(e) {...}` block (`db/local.js:218-224`) with:

```js
    insert(e) {
      const id = uuid();
      db.prepare('INSERT INTO empresas (id, nombre, slug, rut_empresa, nombre_fantasia, contacto, correo, direccion, modulo_tigo, modulo_wom, modulo_preventivo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, e.nombre, e.slug, e.rut_empresa || null,
             e.nombre_fantasia || null, e.contacto || null, e.correo || null, e.direccion || null,
             e.modulo_tigo === false ? 0 : 1, e.modulo_wom === false ? 0 : 1, e.modulo_preventivo === false ? 0 : 1);
      return db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
    },
```

- [ ] **Step 3: Update `empresas.update` to allow the 3 fields**

In the `update(id, f) {...}` block (`db/local.js:226-232`), change the `cols` array:

```js
    update(id, f) {
      const cols = ['nombre','slug','rut_empresa','activa','nombre_fantasia','contacto','correo','direccion','modulo_tigo','modulo_wom','modulo_preventivo'];
      const sets = [], vals = [];
      cols.forEach(k => { if (f[k] !== undefined) { sets.push(k+' = ?'); vals.push(typeof f[k] === 'boolean' ? (f[k] ? 1 : 0) : f[k]); } });
      if (sets.length) { vals.push(id); db.prepare('UPDATE empresas SET '+sets.join(', ')+' WHERE id = ?').run(...vals); }
      return db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
    },
```

- [ ] **Step 4: Verify the migration runs clean**

Delete the local dev DB is NOT needed — `ALTER TABLE ADD COLUMN` is additive. Just restart the server and confirm no errors:

```bash
npm start
```

Expected: server boots normally, no `SQLITE_ERROR` in the log. Then check the columns exist:

```bash
node -e "const db=require('better-sqlite3')('auth.db'); console.log(db.prepare(\"PRAGMA table_info(empresas)\").all().map(c=>c.name));"
```

Expected output includes `modulo_tigo`, `modulo_wom`, `modulo_preventivo`.

- [ ] **Step 5: Commit**

```bash
git add db/local.js
git commit -m "feat: add per-empresa module flags (tigo/wom/preventivo) to SQLite schema"
```

---

## Task 2: Document the Supabase migration (additive SQL, applied manually by the user)

**Files:**
- Modify: `schema/extension.sql`

**Interfaces:**
- Produces: SQL the user runs once in the Supabase SQL editor if/when they use the Supabase backend. Column names match Task 1 exactly (`modulo_tigo`, `modulo_wom`, `modulo_preventivo`), so `db/gestion.js`'s pass-through code (no per-field mapping) works unchanged on both backends.

- [ ] **Step 1: Read the existing file to find where to append**

Open `schema/extension.sql` and find the end of the file (or the empresas-related section).

- [ ] **Step 2: Append the migration**

Add at the end of `schema/extension.sql`:

```sql
-- Módulos legacy fijos habilitados para la empresa (Tigo/WOM/Preventivo).
-- Default true: empresas existentes no pierden acceso a los módulos que ya usaban.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS modulo_tigo boolean DEFAULT true;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS modulo_wom boolean DEFAULT true;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS modulo_preventivo boolean DEFAULT true;
```

- [ ] **Step 3: Commit**

```bash
git add schema/extension.sql
git commit -m "docs: add supabase migration for per-empresa module flags"
```

Note: this task has no runtime verification step — it only ships SQL text. If the deployment uses Supabase, the user must run this SQL manually in their Supabase project before relying on module flags there.

---

## Task 3: Expose module flags in the empresas API (`routes/empresas.js`)

**Files:**
- Modify: `routes/empresas.js:55-85` (POST `/empresas`), `routes/empresas.js:97-132` (PUT `/empresas/:id`)

**Interfaces:**
- Consumes: `db.empresaInsert(fields)`, `db.empresaUpdate(id, fields)` from `db/gestion.js` (unchanged signatures — they pass through whatever object they're given).
- Produces: `POST /api/empresas` and `PUT /api/empresas/:id` now read/write `modulo_tigo`/`modulo_wom`/`modulo_preventivo`. `GET /api/empresas` and `GET /api/empresas/:id` already do `SELECT *`/return the full row, so they need no code change — the new columns show up automatically.

- [ ] **Step 1: Accept module flags on create**

In `routes/empresas.js`, change the destructuring at line 57 and the `db.empresaInsert` call at line 76-82:

```js
    let { nombre, slug, rut_empresa, nombre_fantasia, contacto, correo, direccion, modulo_tigo, modulo_wom, modulo_preventivo } = req.body;
```

(this replaces the existing line 57 destructuring)

Then replace the `empresaInsert` call:

```js
    const empresa = await db.empresaInsert({
      nombre, slug, rut_empresa: rutNorm,
      nombre_fantasia: (nombre_fantasia || '').trim() || null,
      contacto: (contacto || '').trim() || null,
      correo: (correo || '').trim() || null,
      direccion: (direccion || '').trim() || null,
      modulo_tigo: modulo_tigo !== false,
      modulo_wom: modulo_wom !== false,
      modulo_preventivo: modulo_preventivo !== false
    });
```

- [ ] **Step 2: Allow superadmin to edit module flags**

In `routes/empresas.js`, inside the `PUT /empresas/:id` handler (around line 102), add the 3 fields to the destructuring:

```js
    const { nombre, slug, rut_empresa, activa, nombre_fantasia, contacto, correo, direccion, modulo_tigo, modulo_wom, modulo_preventivo } = req.body;
```

Then, right after the existing `if (slug !== undefined && esSuper) fields.slug = ...` / `if (activa !== undefined && esSuper) fields.activa = ...` lines (116-117), add:

```js
    if (modulo_tigo !== undefined && esSuper) fields.modulo_tigo = !!modulo_tigo;
    if (modulo_wom !== undefined && esSuper) fields.modulo_wom = !!modulo_wom;
    if (modulo_preventivo !== undefined && esSuper) fields.modulo_preventivo = !!modulo_preventivo;
```

- [ ] **Step 3: Verify via curl**

Restart the server (`npm start`), log in as the superadmin created earlier (`martinezagueropedro@gmail.com` / `Dota.0412`) to get a token:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"martinezagueropedro@gmail.com","password":"Dota.0412"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")
curl -s -X POST http://localhost:3000/api/empresas -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"nombre":"Test SPA","rut_empresa":"76.086.428-5","modulo_wom":false}'
```

Expected: JSON response with `"ok":true` and `empresa.modulo_wom` equal to `0` (SQLite stores as 0/1) and `empresa.modulo_tigo`/`empresa.modulo_preventivo` equal to `1`.

Then edit it:

```bash
EMPID=<id from previous response>
curl -s -X PUT http://localhost:3000/api/empresas/$EMPID -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"modulo_tigo":false}'
```

Expected: `empresa.modulo_tigo` is now `0`.

- [ ] **Step 4: Commit**

```bash
git add routes/empresas.js
git commit -m "feat: accept module flags (tigo/wom/preventivo) on empresa create/update"
```

---

## Task 4: Surface module flags in `/auth/me`

**Files:**
- Modify: `routes/auth.js:521-542` (`GET /auth/me`)

**Interfaces:**
- Consumes: `gestionDB.empresaById(empresa_id)` (already imported in `routes/auth.js` as `gestionDB`, used at line 527).
- Produces: `/auth/me` response gains a `modulos: { tigo: boolean, wom: boolean, preventivo: boolean }` key, alongside the existing `usuario`/`perfil`/`areas` keys.

- [ ] **Step 1: Compute the flags before the final `res.json`**

In `routes/auth.js`, replace lines 536-537:

```js
    res.json({ usuario: u, perfil: { cargo, nombre, apellidos }, areas });
```

with:

```js
    let modulos = { tigo: true, wom: true, preventivo: true };
    if (u.rol !== 'superadmin' && u.empresa_id) {
      try {
        const empresa = await gestionDB.empresaById(u.empresa_id);
        if (empresa) {
          modulos = {
            tigo: empresa.modulo_tigo !== 0 && empresa.modulo_tigo !== false,
            wom: empresa.modulo_wom !== 0 && empresa.modulo_wom !== false,
            preventivo: empresa.modulo_preventivo !== 0 && empresa.modulo_preventivo !== false
          };
        }
      } catch { /* si falla la consulta, se deja todo habilitado (fail-open, no rompe sesión) */ }
    }

    res.json({ usuario: u, perfil: { cargo, nombre, apellidos }, areas, modulos });
```

- [ ] **Step 2: Verify via curl**

Using the `$EMPID` from Task 3 (which has `modulo_tigo:0`, `modulo_wom:0`), create a user in that empresa and check `/auth/me`:

```bash
curl -s -X POST http://localhost:3000/api/usuarios -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{\"nombre\":\"Test User\",\"email\":\"testuser@test.cl\",\"password\":\"abc123\",\"rol\":\"admin_empresa\",\"empresa_id\":\"$EMPID\"}"
UTOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"testuser@test.cl","password":"abc123"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")
curl -s http://localhost:3000/auth/me -H "Authorization: Bearer $UTOKEN"
```

Expected: `modulos` is `{"tigo":false,"wom":false,"preventivo":true}`.

Also check the superadmin still sees everything:

```bash
curl -s http://localhost:3000/auth/me -H "Authorization: Bearer $TOKEN"
```

Expected: `modulos` is `{"tigo":true,"wom":true,"preventivo":true}`.

- [ ] **Step 3: Commit**

```bash
git add routes/auth.js
git commit -m "feat: expose empresa module flags in /auth/me"
```

---

## Task 5: Gate the 3 static tiles in `dashboard.html`

**Files:**
- Modify: `dashboard.html:525` (Tigo tile), `dashboard.html:537` (WOM tile), `dashboard.html:549` (Preventivo tile), `dashboard.html:769-773` (`init()`)

**Interfaces:**
- Consumes: `modulos: { tigo, wom, preventivo }` from the `/auth/me` fetch already done in `init()` (Task 4's new response field).

- [ ] **Step 1: Add ids to the 3 tiles**

Change line 525 from:

```html
        <a href="/tigo" class="bento-tile is-accent col-2">
```

to:

```html
        <a href="/tigo" id="tileTigo" class="bento-tile is-accent col-2">
```

Change line 537 from:

```html
        <a href="/wom" class="bento-tile is-violet">
```

to:

```html
        <a href="/wom" id="tileWom" class="bento-tile is-violet">
```

Change line 549 from:

```html
        <a href="/preventivo" class="bento-tile is-green">
```

to:

```html
        <a href="/preventivo" id="tilePreventivo" class="bento-tile is-green">
```

- [ ] **Step 2: Hide disabled tiles in `init()`**

In `dashboard.html`, change line 773 from:

```js
    const { usuario, perfil = {}, areas = [] } = await r.json();
```

to:

```js
    const { usuario, perfil = {}, areas = [], modulos = { tigo: true, wom: true, preventivo: true } } = await r.json();
```

Then, right after that line, add:

```js
    if (!modulos.tigo) document.getElementById('tileTigo').style.display = 'none';
    if (!modulos.wom) document.getElementById('tileWom').style.display = 'none';
    if (!modulos.preventivo) document.getElementById('tilePreventivo').style.display = 'none';
```

- [ ] **Step 3: Verify in the browser**

Restart the server, log in as `testuser@test.cl` / `abc123` (the empresa with `modulo_tigo:false`, `modulo_wom:false` from Task 4) at `http://localhost:3000/login`, land on `/dashboard` (or wherever login redirects), and confirm only the Preventivo tile shows — Tigo and WOM tiles are gone.

Then log in as the superadmin and confirm all 3 tiles show.

- [ ] **Step 4: Commit**

```bash
git add dashboard.html
git commit -m "feat: hide Tigo/WOM/Preventivo dashboard tiles per empresa module flags"
```

---

## Task 6: Add module checkboxes to `admin.html` empresa forms

**Files:**
- Modify: `admin.html:772-786` (`modalEmpresa`), `admin.html:787-798` (`crearEmpresa`), `admin.html:799-825` (`modalEditarEmpresa`), `admin.html:826-837` (`guardarEmpresa`)

**Interfaces:**
- Consumes: `esc()` (existing HTML-escape helper already used throughout `admin.html`), `api()` (existing fetch wrapper), `ME.rol` (existing current-user-role global).
- Produces: `POST /api/empresas` and `PUT /api/empresas/:id` calls from the UI now include `modulo_tigo`/`modulo_wom`/`modulo_preventivo` booleans.

- [ ] **Step 1: Add checkboxes to the create modal**

In `admin.html`, in `modalEmpresa()`, change line 781 (the slug field, last field before `mErr`) from:

```html
    <div class="field"><label>Identificador (slug)</label><input id="mSlug" placeholder="icetel"><div class="hint">Opcional · se genera del nombre si lo dejas vacío.</div></div>
```

to (adds the slug field back, plus a new module-flags field):

```html
    <div class="field"><label>Identificador (slug)</label><input id="mSlug" placeholder="icetel"><div class="hint">Opcional · se genera del nombre si lo dejas vacío.</div></div>
    <div class="field"><label>Módulos habilitados</label>
      <div style="display:flex;gap:16px;margin-top:4px;">
        <label style="display:flex;align-items:center;gap:6px;font-weight:400;"><input type="checkbox" id="mModTigo" checked> Tigo</label>
        <label style="display:flex;align-items:center;gap:6px;font-weight:400;"><input type="checkbox" id="mModWom" checked> WOM</label>
        <label style="display:flex;align-items:center;gap:6px;font-weight:400;"><input type="checkbox" id="mModPrev" checked> Preventivo</label>
      </div>
    </div>
```

- [ ] **Step 2: Send the flags on create**

In `crearEmpresa()`, change the `body` object (line 791-793) from:

```js
  const body={ nombre, slug:slug||undefined, rut_empresa:rut_empresa||undefined,
    nombre_fantasia:$('mFantasia').value.trim(), contacto:$('mContacto').value.trim(),
    correo:$('mCorreo').value.trim(), direccion:$('mDireccion').value.trim() };
```

to:

```js
  const body={ nombre, slug:slug||undefined, rut_empresa:rut_empresa||undefined,
    nombre_fantasia:$('mFantasia').value.trim(), contacto:$('mContacto').value.trim(),
    correo:$('mCorreo').value.trim(), direccion:$('mDireccion').value.trim(),
    modulo_tigo:$('mModTigo').checked, modulo_wom:$('mModWom').checked, modulo_preventivo:$('mModPrev').checked };
```

- [ ] **Step 3: Add checkboxes to the edit modal (superadmin only)**

In `modalEditarEmpresa()`, change the `camposSuper` template (lines 803-805) from:

```js
  const camposSuper = esSuper ? `
    <div class="field"><label>Identificador (slug)</label><input id="eeSlug" value="${esc(e.slug)}"></div>
    <div class="field"><label>Estado</label><select id="eeActiva"><option value="1" ${e.activa?'selected':''}>Activa</option><option value="0" ${!e.activa?'selected':''}>Inactiva</option></select></div>` : '';
```

to:

```js
  const camposSuper = esSuper ? `
    <div class="field"><label>Identificador (slug)</label><input id="eeSlug" value="${esc(e.slug)}"></div>
    <div class="field"><label>Estado</label><select id="eeActiva"><option value="1" ${e.activa?'selected':''}>Activa</option><option value="0" ${!e.activa?'selected':''}>Inactiva</option></select></div>
    <div class="field"><label>Módulos habilitados</label>
      <div style="display:flex;gap:16px;margin-top:4px;">
        <label style="display:flex;align-items:center;gap:6px;font-weight:400;"><input type="checkbox" id="eeModTigo" ${e.modulo_tigo!==0&&e.modulo_tigo!==false?'checked':''}> Tigo</label>
        <label style="display:flex;align-items:center;gap:6px;font-weight:400;"><input type="checkbox" id="eeModWom" ${e.modulo_wom!==0&&e.modulo_wom!==false?'checked':''}> WOM</label>
        <label style="display:flex;align-items:center;gap:6px;font-weight:400;"><input type="checkbox" id="eeModPrev" ${e.modulo_preventivo!==0&&e.modulo_preventivo!==false?'checked':''}> Preventivo</label>
      </div>
    </div>` : '';
```

- [ ] **Step 4: Send the flags on edit**

In `guardarEmpresa()`, after the existing lines (830-831):

```js
  if($('eeSlug')) body.slug = $('eeSlug').value.trim().toLowerCase();
  if($('eeActiva')) body.activa = $('eeActiva').value==='1';
```

add:

```js
  if($('eeModTigo')) body.modulo_tigo = $('eeModTigo').checked;
  if($('eeModWom')) body.modulo_wom = $('eeModWom').checked;
  if($('eeModPrev')) body.modulo_preventivo = $('eeModPrev').checked;
```

- [ ] **Step 5: Verify in the browser**

Restart the server, log in as superadmin at `/admin`, go to Empresas → "+ Nueva empresa", uncheck WOM, create it, confirm via `GET /api/empresas` (or re-opening the edit modal) that `modulo_wom` is false and the checkbox reflects that. Then edit an existing empresa, toggle Preventivo off, save, and confirm it persists.

- [ ] **Step 6: Commit**

```bash
git add admin.html
git commit -m "feat: add module checkboxes (tigo/wom/preventivo) to admin empresa forms"
```

---

## Task 7: Enforce module access server-side (`middleware/modulos.js` + `server.js`)

**Files:**
- Create: `middleware/modulos.js`
- Modify: `server.js:124` (`/tareas` mount), `server.js:1252,1305,1310,1326,1333,1355,1370,1376,1392,1408` (Tigo routes), `server.js:2065,2109,2114,2130,2137,2380,2382,2397,2412` (WOM routes), `server.js:2252,2345,2350,2366` (Preventivo routes)

**Interfaces:**
- Consumes: `gestionDb` (already imported in `server.js` at line 19), `req.user` (`{ usuario_id, rol, empresa_id, areas_permitidas }` from JWT, set by `authMiddleware`).
- Produces: `requireModulo(modulo)` — an Express middleware factory. `superadmin` always passes; other roles get `403` if their empresa's `modulo_<modulo>` flag is falsy.

- [ ] **Step 1: Create the middleware**

Create `middleware/modulos.js`:

```js
const gestionDb = require('../db/gestion');

// Bloquea el acceso a un módulo legacy fijo (tigo/wom/preventivo) si la
// empresa del usuario no lo tiene habilitado. superadmin pasa siempre
// (administra todos los módulos de todas las empresas).
function requireModulo(modulo) {
  const campo = 'modulo_' + modulo;
  return async (req, res, next) => {
    try {
      if (req.user.rol === 'superadmin') return next();
      const empresa = await gestionDb.empresaById(req.user.empresa_id);
      if (empresa && (empresa[campo] === 0 || empresa[campo] === false)) {
        return res.status(403).json({ error: `Tu empresa no tiene habilitado el módulo ${modulo}` });
      }
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { requireModulo };
```

- [ ] **Step 2: Import it in `server.js`**

Right after line 22 (`const { requireRol, requireNivel } = require('./middleware/roles');`), add:

```js
const { requireModulo } = require('./middleware/modulos');
```

- [ ] **Step 3: Gate the `/tareas` mount (Preventivo)**

Change `server.js:124` from:

```js
app.use('/tareas', preventivoRoutes);
```

to:

```js
app.use('/tareas', authMiddleware, requireModulo('preventivo'), preventivoRoutes);
```

(Note: `preventivoRoutes` internally may call `authMiddleware` again per-route — that's harmless, `authMiddleware` just re-verifies the same token. Confirm this by checking `routes/preventivo.js`'s own `router.use(...)` line before this step; if it already calls `authMiddleware`, the added one here still runs first and is redundant-but-safe.)

- [ ] **Step 4: Gate the Tigo routes**

For each of these lines in `server.js`, insert `requireModulo('tigo'),` immediately after `authMiddleware,`:

- Line 1252: `app.post('/generar', authMiddleware, requireModulo('tigo'), async (req,res) => {`
- Line 1305: `app.get('/registro', authMiddleware, requireModulo('tigo'), async (req,res) => {`
- Line 1310: `app.get('/descargar/:id', authMiddleware, requireModulo('tigo'), async (req,res) => {`
- Line 1326: `app.get('/ver-pdf/:id', authMiddleware, requireModulo('tigo'), pdfLimiter, async (req, res) => {`
- Line 1333: `app.post('/enviar/:id', authMiddleware, requireModulo('tigo'), async (req,res) => {`
- Line 1355: `app.delete('/registro/:id', authMiddleware, requireModulo('tigo'), async (req,res) => {`
- Line 1370: `app.get('/papelera', authMiddleware, requireModulo('tigo'), async (req,res) => {`
- Line 1376: `app.post('/papelera/restaurar/:id', authMiddleware, requireModulo('tigo'), async (req,res) => {`
- Line 1392: `app.delete('/papelera/:id', authMiddleware, requireModulo('tigo'), async (req,res) => {`
- Line 1408: `app.delete('/papelera', authMiddleware, requireModulo('tigo'), async (req,res) => {`

- [ ] **Step 5: Gate the WOM routes**

For each of these lines in `server.js`, insert `requireModulo('wom'),` immediately after `authMiddleware,`:

- Line 2065: `app.post('/generar-wom', authMiddleware, requireModulo('wom'), async (req, res) => {`
- Line 2109: `app.get('/registro-wom', authMiddleware, requireModulo('wom'), async (req, res) => {`
- Line 2114: `app.get('/descargar-wom/:id', authMiddleware, requireModulo('wom'), async (req, res) => {`
- Line 2130: `app.get('/ver-pdf-wom/:id', authMiddleware, requireModulo('wom'), pdfLimiter, async (req, res) => {`
- Line 2137: `app.delete('/registro-wom/:id', authMiddleware, requireModulo('wom'), async (req, res) => {`
- Line 2380: `app.get('/papelera-wom', authMiddleware, requireModulo('wom'), async (req, res) => res.json(filtrarInformesPorEmpresa(await dbPapeleraWomList(), req.user)));`
- Line 2382: `app.post('/papelera-wom/restaurar/:id', authMiddleware, requireModulo('wom'), async (req, res) => {`
- Line 2397: `app.delete('/papelera-wom/:id', authMiddleware, requireModulo('wom'), async (req, res) => {`
- Line 2412: `app.delete('/papelera-wom', authMiddleware, requireModulo('wom'), async (req, res) => {`

- [ ] **Step 6: Gate the remaining Preventivo routes**

For each of these lines in `server.js`, insert `requireModulo('preventivo'),` immediately after `authMiddleware,`:

- Line 2252: `app.post('/generar-preventivo', authMiddleware, requireModulo('preventivo'), async (req, res) => {`
- Line 2345: `app.get('/registro-prev', authMiddleware, requireModulo('preventivo'), async (req, res) => {`
- Line 2350: `app.get('/descargar-prev/:id', authMiddleware, requireModulo('preventivo'), async (req, res) => {`
- Line 2366: `app.delete('/registro-prev/:id', authMiddleware, requireModulo('preventivo'), async (req, res) => {`

- [ ] **Step 7: Verify enforcement via curl**

Restart the server. Using `$UTOKEN` (the `testuser@test.cl` user from Task 4, whose empresa has `modulo_tigo:false`, `modulo_wom:false`, `modulo_preventivo:true`):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/registro -H "Authorization: Bearer $UTOKEN"
```

Expected: `403`.

```bash
curl -s http://localhost:3000/registro -H "Authorization: Bearer $UTOKEN"
```

Expected body: `{"error":"Tu empresa no tiene habilitado el módulo tigo"}`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/tareas/informes-map -H "Authorization: Bearer $UTOKEN"
```

Expected: NOT `403` (preventivo is enabled for this empresa) — should be whatever status that route normally returns (200 or 4xx unrelated to modules).

Then confirm the superadmin token still works everywhere:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/registro -H "Authorization: Bearer $TOKEN"
```

Expected: NOT `403`.

- [ ] **Step 8: Commit**

```bash
git add middleware/modulos.js server.js
git commit -m "feat: enforce empresa module flags on Tigo/WOM/Preventivo routes"
```

---

## Task 8: Clean up manual test data

**Files:**
- None (data cleanup only, via API)

- [ ] **Step 1: Remove the test empresa/user created during verification**

The `Test SPA` empresa and `testuser@test.cl` user created in Tasks 3-4 were for verification only. Deactivate the empresa (there's no hard-delete endpoint for empresas in this codebase):

```bash
curl -s -X PUT http://localhost:3000/api/empresas/$EMPID -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"activa":false}'
```

Expected: `empresa.activa` is `0`.

- [ ] **Step 2: No commit needed** (this task only touches runtime data, not files).

---

## Self-Review Notes

- **Spec coverage:** Data model (Task 1-2), empresa API (Task 3), `/auth/me` (Task 4), dashboard gating (Task 5), admin UI (Task 6), backend enforcement (Task 7) — all 6 spec sections have a corresponding task. "Fuera de alcance" items (proyectos genéricos, sitios-preventivos, nuevos roles) are untouched by design.
- **Type consistency:** `modulo_tigo`/`modulo_wom`/`modulo_preventivo` names are identical across `db/local.js`, `schema/extension.sql`, `routes/empresas.js`, `routes/auth.js`, `middleware/modulos.js`, `admin.html`, and the spec. `requireModulo(modulo)` takes the bare word (`'tigo'`, `'wom'`, `'preventivo'`) and prefixes `modulo_` internally — used consistently in Task 7.
- **No placeholders:** every step has literal code or literal curl commands with expected output.
