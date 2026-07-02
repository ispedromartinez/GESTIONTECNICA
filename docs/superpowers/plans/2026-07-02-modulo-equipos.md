# Módulo Activos/Equipos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoja de vida de equipos: tabla resumen `equipos` poblada automáticamente al generar informes TIGO/WOM, con historial en vivo y pestaña UI en catalogo.html.

**Architecture:** Tabla caché `equipos` con clave natural `(empresa_id, sitio, numero)` en backend dual (Supabase / SQLite local). Upsert no-bloqueante desde `/generar` y `/generar-wom`. Historial consultado en vivo contra `informes_clima`/`informes_wom` (requiere columnas nuevas `eq_numero`/`equipo` en esos registros). Backfill idempotente para datos históricos.

**Tech Stack:** Node/Express, better-sqlite3, @supabase/supabase-js, HTML/JS vanilla.

## Global Constraints

- Patrón dual obligatorio: `if (supabase) {...} else {...}` en todo helper de datos (CLAUDE.md).
- Al agregar campos a informes: actualizar AMBOS paths y los mappers `fromX`/`toX` camelCase↔snake_case (CLAUDE.md).
- Aislamiento tenant: filtrar por `empresa_id` de `req.user` vía `scopeToTenant`/`canAccessTenant` de `middleware/tenant.js`; recursos con `empresa_id null` solo los ve superadmin.
- El upsert de equipos NUNCA rompe la generación de informes (try/catch + console.error, patrón `vincularInformeGestion`).
- Sin test runner: verificación por curl/navegador con el servidor local (`USE_LOCAL_DB` implícito al no haber Supabase configurado).
- Todo dato de usuario que entre a `innerHTML` en frontend pasa por `esc()`.
- Normalización de clave de equipo: `trim()` + colapsar espacios + lowercase para comparar; se guarda la grafía original más reciente.

**Nota servidor:** hay una instancia corriendo en el puerto 3000 (`server.log`). Para probar cambios: matar proceso node del puerto 3000 y relanzar `node server.js > server.log 2>&1 &`, o usar `PORT=3100`. Los curls de este plan asumen puerto 3000 con servidor recién reiniciado.

**Nota auth:** los endpoints exigen Bearer token. Obtener uno:
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"<email superadmin>","password":"<password>"}' | python -c "import sys,json;print(json.load(sys.stdin)['token'])")
```
(el ejecutor debe pedir credenciales al usuario si no las tiene; NO inventarlas).

---

### Task 1: Helper dual `db/equipos.js` + schema Supabase

**Files:**
- Create: `db/equipos.js`
- Create: `schema/equipos.sql`
- Modify: `db/local.js` (crear tabla `equipos` en el bloque de migraciones)

**Interfaces:**
- Produces:
  - `equiposDb.upsertDesdeInforme({ empresaId, sitio, numero, tipo, marca, modelo, fecha })` → Promise<void>
  - `equiposDb.list()` → Promise<Array<equipo>> (todos los tenants; el aislamiento lo aplica la ruta con `scopeToTenant`)
  - `equiposDb.findById(id)` → Promise<equipo|null>
  - `equiposDb.resetAll()` → Promise<void> (borra todo; usado por backfill)
  - Forma de `equipo`: `{ id, empresaId, sitio, numero, tipo, marca, modelo, totalIntervenciones, primeraIntervencion, ultimaIntervencion, creadoEn, actualizadoEn }`
  - Función exportada `claveEquipo(sitio, numero)` → string normalizado `"sitio|numero"` (trim, espacios colapsados, lowercase)

- [ ] **Step 1: Tabla en SQLite local**

En `db/local.js`, después del bloque de migraciones idempotentes (línea ~131), agregar:

```js
// Equipos (hoja de vida de activos): tabla resumen, clave natural sitio+numero por tenant
db.exec(`
  CREATE TABLE IF NOT EXISTS equipos (
    id                   TEXT PRIMARY KEY,
    empresa_id           TEXT,
    sitio                TEXT NOT NULL,
    numero               TEXT NOT NULL,
    clave                TEXT NOT NULL,
    tipo                 TEXT,
    marca                TEXT,
    modelo               TEXT,
    total_intervenciones INTEGER DEFAULT 0,
    primera_intervencion TEXT,
    ultima_intervencion  TEXT,
    creado_en            TEXT DEFAULT (datetime('now')),
    actualizado_en       TEXT DEFAULT (datetime('now')),
    UNIQUE(empresa_id, clave)
  );
  CREATE INDEX IF NOT EXISTS idx_equipos_empresa ON equipos(empresa_id);
`);
```

Y exponer en el objeto `local` (antes de `module.exports`):

```js
  // Equipos (hoja de vida)
  equipos: {
    findByClave(empresa_id, clave) {
      if (empresa_id) return db.prepare('SELECT * FROM equipos WHERE empresa_id = ? AND clave = ?').get(empresa_id, clave);
      return db.prepare('SELECT * FROM equipos WHERE empresa_id IS NULL AND clave = ?').get(clave);
    },
    findById(id) {
      return db.prepare('SELECT * FROM equipos WHERE id = ?').get(id);
    },
    insert(e) {
      const id = uuid();
      db.prepare(`
        INSERT INTO equipos (id, empresa_id, sitio, numero, clave, tipo, marca, modelo,
                             total_intervenciones, primera_intervencion, ultima_intervencion)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, e.empresa_id || null, e.sitio, e.numero, e.clave, e.tipo || null,
             e.marca || null, e.modelo || null, e.total_intervenciones || 1,
             e.primera_intervencion || null, e.ultima_intervencion || null);
      return db.prepare('SELECT * FROM equipos WHERE id = ?').get(id);
    },
    update(id, f) {
      const cols = ['sitio','numero','tipo','marca','modelo','total_intervenciones','primera_intervencion','ultima_intervencion'];
      const sets = [], vals = [];
      cols.forEach(k => { if (f[k] !== undefined) { sets.push(k+' = ?'); vals.push(f[k]); } });
      if (sets.length) {
        sets.push("actualizado_en = datetime('now')");
        vals.push(id);
        db.prepare('UPDATE equipos SET '+sets.join(', ')+' WHERE id = ?').run(...vals);
      }
      return db.prepare('SELECT * FROM equipos WHERE id = ?').get(id);
    },
    list(empresa_id) {
      if (empresa_id) return db.prepare('SELECT * FROM equipos WHERE empresa_id = ? ORDER BY ultima_intervencion DESC').all(empresa_id);
      return db.prepare('SELECT * FROM equipos ORDER BY ultima_intervencion DESC').all();
    },
    deleteAll() {
      db.prepare('DELETE FROM equipos').run();
    }
  },
```

- [ ] **Step 2: Schema Supabase**

Create `schema/equipos.sql`:

```sql
-- Hoja de vida de equipos: tabla resumen poblada automáticamente al generar informes.
CREATE TABLE IF NOT EXISTS equipos (
  id                   TEXT PRIMARY KEY,
  empresa_id           TEXT,
  sitio                TEXT NOT NULL,
  numero               TEXT NOT NULL,
  clave                TEXT NOT NULL,
  tipo                 TEXT,
  marca                TEXT,
  modelo               TEXT,
  total_intervenciones INTEGER DEFAULT 0,
  primera_intervencion TEXT,
  ultima_intervencion  TEXT,
  creado_en            TIMESTAMPTZ DEFAULT now(),
  actualizado_en       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_id, clave)
);
CREATE INDEX IF NOT EXISTS idx_equipos_empresa ON equipos(empresa_id);

-- Columnas nuevas en los registros de informes para ligar informe→equipo:
ALTER TABLE informes_clima ADD COLUMN IF NOT EXISTS eq_numero TEXT;
ALTER TABLE informes_wom   ADD COLUMN IF NOT EXISTS equipo   TEXT;
```

- [ ] **Step 3: Helper dual `db/equipos.js`**

```js
// ── Equipos (hoja de vida de activos) ─────────────────────────────
// Tabla RESUMEN con clave natural (empresa_id, sitio, numero). El detalle
// de cada intervención vive en informes_clima / informes_wom; aquí solo
// contadores y últimos datos conocidos del equipo.
const { supabase } = require('./supabase');
const local = require('./local');

// Clave normalizada: trim + espacios colapsados + lowercase.
// Compara "SALA 1 " y "sala 1" como el mismo equipo.
function norm(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' '); }
function claveEquipo(sitio, numero) {
  return `${norm(sitio).toLowerCase()}|${norm(numero).toLowerCase()}`;
}

const fromRow = r => r && ({
  id: r.id, empresaId: r.empresa_id || null,
  sitio: r.sitio, numero: r.numero,
  tipo: r.tipo, marca: r.marca, modelo: r.modelo,
  totalIntervenciones: r.total_intervenciones || 0,
  primeraIntervencion: r.primera_intervencion,
  ultimaIntervencion: r.ultima_intervencion,
  creadoEn: r.creado_en, actualizadoEn: r.actualizado_en
});

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Crea o actualiza el equipo a partir de un informe generado.
// fecha: fecha de ejecución del informe (YYYY-MM-DD).
async function upsertDesdeInforme({ empresaId, sitio, numero, tipo, marca, modelo, fecha }) {
  const s = norm(sitio), n = norm(numero);
  if (!s || !n) return; // sin sitio o sin nº de equipo no hay identidad
  const clave = claveEquipo(s, n);
  const f = fecha || null;

  if (supabase) {
    let q = supabase.from('equipos').select('*').eq('clave', clave);
    q = empresaId ? q.eq('empresa_id', empresaId) : q.is('empresa_id', null);
    const { data: rows, error } = await q.limit(1);
    if (error) { console.error('equipos find:', error.message); return; }
    const ex = rows && rows[0];
    if (!ex) {
      const { error: e2 } = await supabase.from('equipos').insert({
        id: uuid(), empresa_id: empresaId || null, sitio: s, numero: n, clave,
        tipo: norm(tipo) || null, marca: norm(marca) || null, modelo: norm(modelo) || null,
        total_intervenciones: 1, primera_intervencion: f, ultima_intervencion: f
      });
      if (e2) console.error('equipos insert:', e2.message);
    } else {
      const fields = {
        sitio: s, numero: n,
        total_intervenciones: (ex.total_intervenciones || 0) + 1,
        actualizado_en: new Date().toISOString()
      };
      // marca/modelo/tipo: el informe más reciente manda, solo si trae valor
      if (norm(tipo))   fields.tipo   = norm(tipo);
      if (norm(marca))  fields.marca  = norm(marca);
      if (norm(modelo)) fields.modelo = norm(modelo);
      if (f && (!ex.primera_intervencion || f < ex.primera_intervencion)) fields.primera_intervencion = f;
      if (f && (!ex.ultima_intervencion  || f > ex.ultima_intervencion))  fields.ultima_intervencion = f;
      const { error: e3 } = await supabase.from('equipos').update(fields).eq('id', ex.id);
      if (e3) console.error('equipos update:', e3.message);
    }
    return;
  }

  // Local (SQLite)
  const ex = local.equipos.findByClave(empresaId || null, clave);
  if (!ex) {
    local.equipos.insert({
      empresa_id: empresaId || null, sitio: s, numero: n, clave,
      tipo: norm(tipo) || null, marca: norm(marca) || null, modelo: norm(modelo) || null,
      total_intervenciones: 1, primera_intervencion: f, ultima_intervencion: f
    });
  } else {
    const fields = { sitio: s, numero: n, total_intervenciones: (ex.total_intervenciones || 0) + 1 };
    if (norm(tipo))   fields.tipo   = norm(tipo);
    if (norm(marca))  fields.marca  = norm(marca);
    if (norm(modelo)) fields.modelo = norm(modelo);
    if (f && (!ex.primera_intervencion || f < ex.primera_intervencion)) fields.primera_intervencion = f;
    if (f && (!ex.ultima_intervencion  || f > ex.ultima_intervencion))  fields.ultima_intervencion = f;
    local.equipos.update(ex.id, fields);
  }
}

async function list() {
  if (supabase) {
    const { data, error } = await supabase.from('equipos').select('*')
      .order('ultima_intervencion', { ascending: false });
    if (error) { console.error('equipos list:', error.message); return []; }
    return (data || []).map(fromRow);
  }
  return local.equipos.list(null).map(fromRow);
}

async function findById(id) {
  if (supabase) {
    const { data, error } = await supabase.from('equipos').select('*').eq('id', id).single();
    if (error || !data) return null;
    return fromRow(data);
  }
  return fromRow(local.equipos.findById(id)) || null;
}

async function resetAll() {
  if (supabase) {
    const { error } = await supabase.from('equipos').delete().neq('id', '');
    if (error) console.error('equipos resetAll:', error.message);
    return;
  }
  local.equipos.deleteAll();
}

module.exports = { upsertDesdeInforme, list, findById, resetAll, claveEquipo, norm };
```

- [ ] **Step 4: Verificar carga del módulo**

Run: `node -e "const e=require('./db/equipos'); console.log(typeof e.upsertDesdeInforme, e.claveEquipo(' SALA  Central ', ' AC-01 '))"`
Expected: `function sala central|ac-01`

- [ ] **Step 5: Commit**

```bash
git add db/equipos.js db/local.js schema/equipos.sql
git commit -m "Equipos: helper dual (Supabase/SQLite) y schema de hoja de vida"
```

---

### Task 2: Registrar nº de equipo en informes + upsert automático al generar

**Files:**
- Modify: `server.js` — mappers `fromClima`/`toClima` (~línea 357), `fromWom`/`toWom` (~línea 1182), entry en `POST /generar` (~línea 1029), entry en `POST /generar-wom` (~línea 1811), require arriba (~línea 25)

**Interfaces:**
- Consumes: `require('./db/equipos')` → `{ upsertDesdeInforme }` (Task 1)
- Produces: registros de informes clima con campo `eqNumero` (JSON local) / `eq_numero` (Supabase); WOM con `equipo`. Los usa Task 3 (historial).

- [ ] **Step 1: Require del helper**

En `server.js`, junto a los otros require de db (después de `const gestionDb = require('./db/gestion');`):

```js
const equiposDb = require('./db/equipos');
```

- [ ] **Step 2: Mappers clima — campo nuevo en AMBOS sentidos**

`fromClima`: agregar `eqNumero: r.eq_numero || null,` antes de `empresaId`.
`toClima`: agregar `eq_numero: e.eqNumero || null,` antes de `empresa_id`.

- [ ] **Step 3: Mappers WOM**

`fromWom`: agregar `equipo: r.equipo || null,` antes de `empresaId`.
`toWom`: agregar `equipo: e.equipo || null,` antes de `empresa_id`.

- [ ] **Step 4: Entry + upsert en POST /generar (TIGO)**

En el objeto `entry` de `/generar`, agregar tras `numOT: d.numOT,`:

```js
      eqNumero: d.eqNumero || null,
```

Después de `await dbClimaInsert(entry);` agregar:

```js
    // Hoja de vida: registra/actualiza el equipo. Nunca rompe la generación.
    try {
      await equiposDb.upsertDesdeInforme({
        empresaId: req.user.empresa_id || null,
        sitio: d.nombreSitio, numero: d.eqNumero,
        tipo: d.eqTipo, marca: d.eqMarca, modelo: d.eqModelo,
        fecha: d.fecha
      });
    } catch (e) { console.error('equipos upsert (clima):', e.message); }
```

- [ ] **Step 5: Entry + upsert en POST /generar-wom**

En el objeto `entry` de `/generar-wom`, tras `tipoActividad: d.tipoActividad,`:

```js
      equipo: d.equipo || null,
```

Después de `await dbWomInsert(entry);`:

```js
    // Hoja de vida: registra/actualiza el equipo. Nunca rompe la generación.
    try {
      await equiposDb.upsertDesdeInforme({
        empresaId: req.user.empresa_id || null,
        sitio: d.instalacion, numero: d.equipo,
        marca: d.marca, modelo: d.modelo,
        fecha: d.fechaInicio
      });
    } catch (e) { console.error('equipos upsert (wom):', e.message); }
```

- [ ] **Step 6: Verificar sintaxis y generación**

Run: `node --check server.js`
Expected: sin salida (OK).

Reiniciar servidor y generar informe de prueba (con TOKEN de superadmin):

```bash
curl -s -X POST http://localhost:3000/generar -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"codInforme":"TEST-EQ-01","nombreSitio":"Sitio Prueba EQ","codigoSitio":"SPE","tecnico":"Tester","fecha":"2026-07-02","eqNumero":"AC-01","eqTipo":"Split","eqMarca":"Midea","eqModelo":"X-100","photos":[]}' \
  -o /tmp/test-eq.docx -w '%{http_code}\n'
```
Expected: `200`. Y en `registro.json`: la entrada nueva tiene `"eqNumero": "AC-01"`. En `auth.db`: `SELECT sitio, numero, total_intervenciones FROM equipos` → fila `Sitio Prueba EQ | AC-01 | 1`.

Repetir el mismo curl → `total_intervenciones` = 2 (no crea equipo duplicado).

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "Equipos: registrar numero de equipo en informes y upsert automatico al generar"
```

---

### Task 3: API — lista, historial y backfill

**Files:**
- Modify: `server.js` — nuevas rutas después del bloque `/api/proyectos` (~línea 250), reutilizando `dbClimaList`, `dbWomList`, `scopeToTenant`, `canAccessTenant`

**Interfaces:**
- Consumes: `equiposDb.list/findById/resetAll/upsertDesdeInforme/claveEquipo` (Task 1); campos `eqNumero`/`equipo` en registros (Task 2)
- Produces:
  - `GET /api/equipos?sitio=&q=` → `[{ id, sitio, numero, tipo, marca, modelo, totalIntervenciones, ultimaIntervencion, primeraIntervencion, empresaId }]`
  - `GET /api/equipos/:id/historial` → `{ equipo, historial: [{ tipo:'TIGO'|'WOM', id, fecha, codigo, tecnico, filename, urlDescarga }], delSitio: [...misma forma...] }`
  - `POST /api/equipos/backfill` → `{ ok, procesados, equipos }`

- [ ] **Step 1: Rutas**

Insertar en `server.js` después del endpoint `POST /api/proyectos/sitios/asignar`:

```js
// ── Equipos (hoja de vida de activos) ─────────────────────────
app.get('/api/equipos', authMiddleware, async (req, res) => {
  try {
    let equipos = scopeToTenant(req, await equiposDb.list());
    const sitio = (req.query.sitio || '').trim().toLowerCase();
    if (sitio) equipos = equipos.filter(e => (e.sitio || '').toLowerCase() === sitio);
    const q = (req.query.q || '').trim().toLowerCase();
    if (q) equipos = equipos.filter(e =>
      ['sitio','numero','tipo','marca','modelo'].some(k => (e[k] || '').toLowerCase().includes(q)));
    res.json(equipos);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Historial en vivo: informes TIGO/WOM que corresponden a este equipo.
// Los informes antiguos sin nº de equipo van aparte (delSitio) como contexto.
app.get('/api/equipos/:id/historial', authMiddleware, async (req, res) => {
  try {
    const eq = await equiposDb.findById(req.params.id);
    if (!eq) return res.status(404).json({ error: 'Equipo no encontrado' });
    if (!canAccessTenant(req, eq.empresaId)) return res.status(403).json({ error: 'Equipo de otra empresa' });

    const clave = equiposDb.claveEquipo(eq.sitio, eq.numero);
    const sitioNorm = equiposDb.norm(eq.sitio).toLowerCase();
    const [tigo, wom] = await Promise.all([dbClimaList(null), dbWomList(null)]);
    // Solo informes del mismo tenant que el equipo
    const mismoTenant = r => (r.empresaId || null) === (eq.empresaId || null);

    const historial = [], delSitio = [];
    for (const r of tigo.filter(mismoTenant)) {
      if (equiposDb.norm(r.nombreSitio).toLowerCase() !== sitioNorm) continue;
      const item = {
        tipo: 'TIGO', id: r.id, fecha: r.fecha || (r.fechaCreacion || '').slice(0, 10),
        codigo: r.codInforme || '—', tecnico: r.tecnico || '—',
        filename: r.filename, urlDescarga: `/descargar/${r.id}`
      };
      if (r.eqNumero && equiposDb.claveEquipo(r.nombreSitio, r.eqNumero) === clave) historial.push(item);
      else if (!r.eqNumero) delSitio.push(item);
    }
    for (const r of wom.filter(mismoTenant)) {
      if (equiposDb.norm(r.instalacion).toLowerCase() !== sitioNorm) continue;
      const item = {
        tipo: 'WOM', id: r.id, fecha: (r.fechaInicio || r.fechaCreacion || '').slice(0, 10),
        codigo: r.ticket || r.codInterno || '—', tecnico: r.tecnicos || '—',
        filename: r.filename, urlDescarga: `/descargar-wom/${r.id}`
      };
      if (r.equipo && equiposDb.claveEquipo(r.instalacion, r.equipo) === clave) historial.push(item);
      else if (!r.equipo) delSitio.push(item);
    }
    const porFecha = (a, b) => (b.fecha || '').localeCompare(a.fecha || '');
    historial.sort(porFecha); delSitio.sort(porFecha);
    res.json({ equipo: eq, historial, delSitio });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reconstruye la tabla equipos desde los informes existentes (idempotente).
app.post('/api/equipos/backfill', authMiddleware, requireRol('superadmin'), async (req, res) => {
  try {
    await equiposDb.resetAll();
    const [tigo, wom] = await Promise.all([dbClimaList(null), dbWomList(null)]);
    let procesados = 0;
    for (const r of tigo) {
      if (!r.eqNumero) continue;
      await equiposDb.upsertDesdeInforme({
        empresaId: r.empresaId || null, sitio: r.nombreSitio, numero: r.eqNumero,
        fecha: r.fecha || (r.fechaCreacion || '').slice(0, 10)
      });
      procesados++;
    }
    for (const r of wom) {
      if (!r.equipo) continue;
      await equiposDb.upsertDesdeInforme({
        empresaId: r.empresaId || null, sitio: r.instalacion, numero: r.equipo,
        fecha: (r.fechaInicio || r.fechaCreacion || '').slice(0, 10)
      });
      procesados++;
    }
    const equipos = (await equiposDb.list()).length;
    res.json({ ok: true, procesados, equipos });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 2: Verificar**

`node --check server.js` → OK. Reiniciar servidor.

```bash
curl -s http://localhost:3000/api/equipos -H "Authorization: Bearer $TOKEN"
```
Expected: array con el equipo `AC-01` de Task 2, `totalIntervenciones: 2`.

```bash
EQID=$(curl -s http://localhost:3000/api/equipos -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
curl -s http://localhost:3000/api/equipos/$EQID/historial -H "Authorization: Bearer $TOKEN"
```
Expected: `historial` con los 2 informes TEST-EQ-01, cada uno con `urlDescarga`.

```bash
curl -s -X POST http://localhost:3000/api/equipos/backfill -H "Authorization: Bearer $TOKEN"
```
Expected: `{ ok:true, procesados:2, equipos:1 }` (u otros informes históricos con eqNumero). Re-ejecutar da lo mismo (idempotente).

Sin token → 401. Con token de otro rol el backfill → 403.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "Equipos: API de lista, historial en vivo y backfill"
```

---

### Task 4: Pestaña "Equipos" en catalogo.html

**Files:**
- Modify: `catalogo.html` — tabs en el toolbar, tabla de equipos, modal de ficha con timeline

**Interfaces:**
- Consumes: `GET /api/equipos`, `GET /api/equipos/:id/historial`, `POST /api/equipos/backfill` (Task 3); `esc()` ya definido en la página (~línea 242); interceptor JWT ya inyecta Authorization.

- [ ] **Step 1: Leer la estructura actual de catalogo.html**

Leer el archivo completo antes de editar: identificar el contenedor `.main`, el `.card` de sitios, la tabla existente y dónde viven las funciones JS (`cargarSitios`, render, etc.). Las inserciones siguientes se adaptan a esa estructura real.

- [ ] **Step 2: Tabs de vista**

Antes del `.card` de sitios, insertar un switcher (estilos coherentes con la página):

```html
<div class="view-tabs">
  <button class="vtab active" id="tabSitios" onclick="cambiarVista('sitios')">📍 Sitios</button>
  <button class="vtab" id="tabEquipos" onclick="cambiarVista('equipos')">❄️ Equipos</button>
</div>
```

CSS (dentro del `<style>` de la página):

```css
.view-tabs{display:flex;gap:8px;margin-bottom:14px;}
.vtab{border:1.5px solid var(--border);background:#fff;color:var(--muted);border-radius:9px;
  padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;transition:.15s;}
.vtab:hover{border-color:#CBD5E1;color:var(--text);}
.vtab.active{background:var(--primary);border-color:var(--primary);color:#fff;}
```

`cambiarVista(v)`: muestra/oculta `#cardSitios` (envolver el card actual con ese id) y `#cardEquipos`; carga equipos la primera vez.

- [ ] **Step 3: Card de equipos**

Después del card de sitios:

```html
<div class="card" id="cardEquipos" style="display:none">
  <div class="toolbar">
    <div class="search"><input id="eqSearch" placeholder="Buscar equipo, sitio, marca…" oninput="filtrarEquipos()"></div>
    <span class="count" id="eqCount">0 equipos</span>
    <button class="btn btn-ghost" id="btnBackfill" onclick="backfillEquipos()" style="display:none">↻ Recalcular</button>
  </div>
  <div class="tbl-wrap">
    <table>
      <thead><tr>
        <th>Sitio</th><th>N° Equipo</th><th>Tipo</th><th>Marca / Modelo</th>
        <th>Intervenciones</th><th>Última</th>
      </tr></thead>
      <tbody id="tbodyEquipos"><tr><td colspan="6" class="empty">Cargando…</td></tr></tbody>
    </table>
  </div>
</div>
```

- [ ] **Step 4: Modal ficha del equipo**

```html
<div class="modal-bg" id="modalEquipo">
  <div class="modal" style="max-width:560px">
    <div class="modal-head" id="eqModalTitle">Equipo</div>
    <div class="modal-body" id="eqModalBody"></div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="cerrarModalEquipo()">Cerrar</button></div>
  </div>
</div>
```

- [ ] **Step 5: JS**

```js
// ══ EQUIPOS (hoja de vida) ══
let allEquipos = [], equiposCargados = false;

function cambiarVista(v){
  document.getElementById('tabSitios').classList.toggle('active', v==='sitios');
  document.getElementById('tabEquipos').classList.toggle('active', v==='equipos');
  document.getElementById('cardSitios').style.display = v==='sitios' ? '' : 'none';
  document.getElementById('cardEquipos').style.display = v==='equipos' ? '' : 'none';
  if (v==='equipos' && !equiposCargados) cargarEquipos();
}

async function cargarEquipos(){
  try{
    const r = await fetch('/api/equipos');
    allEquipos = await r.json();
    equiposCargados = true;
    // botón Recalcular solo superadmin (rol viene del token guardado por la página)
    try {
      const u = JSON.parse(localStorage.getItem('usuario')||'{}');
      if (u.rol === 'superadmin') document.getElementById('btnBackfill').style.display='';
    } catch{}
    renderEquipos(allEquipos);
  }catch(e){
    document.getElementById('tbodyEquipos').innerHTML = '<tr><td colspan="6" class="empty">No se pudo cargar.</td></tr>';
  }
}

function filtrarEquipos(){
  const q = (document.getElementById('eqSearch').value||'').toLowerCase();
  renderEquipos(!q ? allEquipos : allEquipos.filter(e =>
    ['sitio','numero','tipo','marca','modelo'].some(k => (e[k]||'').toLowerCase().includes(q))));
}

function renderEquipos(list){
  document.getElementById('eqCount').textContent = `${list.length} equipo${list.length===1?'':'s'}`;
  const tb = document.getElementById('tbodyEquipos');
  if (!list.length){ tb.innerHTML = '<tr><td colspan="6" class="empty">Sin equipos registrados. Se crean automáticamente al generar informes con N° de equipo.</td></tr>'; return; }
  tb.innerHTML = list.map(e => `
    <tr style="cursor:pointer" onclick="abrirEquipo('${e.id}')">
      <td class="td-sitio">${esc(e.sitio)}</td>
      <td><strong>${esc(e.numero)}</strong></td>
      <td>${esc(e.tipo)||'—'}</td>
      <td class="td-dir">${esc([e.marca,e.modelo].filter(Boolean).join(' / '))||'—'}</td>
      <td><span class="badge badge--info">${e.totalIntervenciones||0}</span></td>
      <td class="td-dir">${esc(e.ultimaIntervencion)||'—'}</td>
    </tr>`).join('');
}

async function abrirEquipo(id){
  const bg = document.getElementById('modalEquipo');
  document.getElementById('eqModalBody').innerHTML = '<div class="empty">Cargando…</div>';
  bg.classList.add('show');
  try{
    const r = await fetch(`/api/equipos/${id}/historial`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error||'Error');
    const eq = d.equipo;
    document.getElementById('eqModalTitle').textContent = `${eq.sitio} · ${eq.numero}`;
    const fila = i => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid #F1F5F9;font-size:13px">
        <span class="badge ${i.tipo==='TIGO'?'badge--info':'badge--warning'}">${i.tipo}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">${esc(i.codigo)}</div>
          <div style="font-size:11px;color:var(--muted)">${esc(i.fecha)||'—'} · ${esc(i.tecnico)}</div>
        </div>
        <button class="btn btn-ghost" style="padding:6px 10px" onclick="descargarInforme('${i.urlDescarga}','${esc(i.filename||'informe')}')">⬇</button>
      </div>`;
    document.getElementById('eqModalBody').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;font-size:13px">
        <div><span style="color:var(--muted);font-size:11px">TIPO</span><br>${esc(eq.tipo)||'—'}</div>
        <div><span style="color:var(--muted);font-size:11px">MARCA / MODELO</span><br>${esc([eq.marca,eq.modelo].filter(Boolean).join(' / '))||'—'}</div>
        <div><span style="color:var(--muted);font-size:11px">INTERVENCIONES</span><br>${eq.totalIntervenciones||0}</div>
        <div><span style="color:var(--muted);font-size:11px">PRIMERA / ÚLTIMA</span><br>${esc(eq.primeraIntervencion)||'—'} → ${esc(eq.ultimaIntervencion)||'—'}</div>
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Historial (${d.historial.length})</div>
      ${d.historial.map(fila).join('') || '<div class="empty" style="padding:14px">Sin informes ligados a este equipo aún.</div>'}
      ${d.delSitio.length ? `
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 4px">Otros informes del sitio sin N° de equipo (${d.delSitio.length})</div>
        ${d.delSitio.map(fila).join('')}` : ''}`;
  }catch(e){
    document.getElementById('eqModalBody').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}
function cerrarModalEquipo(){ document.getElementById('modalEquipo').classList.remove('show'); }

async function descargarInforme(url, fn){
  try{
    const r = await fetch(url);
    if(!r.ok) throw new Error('Error al descargar');
    const blob = await r.blob();
    const u = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href=u; a.download=fn; a.click(); URL.revokeObjectURL(u);
  }catch(e){ alert(e.message); }
}

async function backfillEquipos(){
  const b = document.getElementById('btnBackfill'); b.disabled = true;
  try{
    const r = await fetch('/api/equipos/backfill', { method:'POST' });
    const d = await r.json();
    if(!r.ok) throw new Error(d.error||'Error');
    equiposCargados = false; await cargarEquipos();
    alert(`Recalculado: ${d.procesados} informes → ${d.equipos} equipos`);
  }catch(e){ alert(e.message); } finally { b.disabled = false; }
}
```

Nota: el modal solo cierra con el botón Cerrar (regla del proyecto: commit "Modales: cerrar solo via boton explicito"). No agregar cierre por click en overlay. Adaptar la detección de rol superadmin a cómo la página realmente guarda el usuario (revisar en Step 1; si usa otra key de localStorage, usar esa).

- [ ] **Step 6: Verificar en navegador**

Servidor corriendo → `http://localhost:3000/catalogo` con sesión iniciada:
1. Tab Equipos visible, lista al equipo AC-01 con 2 intervenciones.
2. Click en fila → modal con ficha + historial de 2 informes + descarga funciona.
3. Buscador filtra por "midea".
4. Botón Recalcular visible solo como superadmin y funciona.
5. Tab Sitios sigue funcionando igual que antes.

- [ ] **Step 7: Commit**

```bash
git add catalogo.html
git commit -m "Equipos: pestana de hoja de vida en catalogo con ficha e historial"
```

---

### Task 5: Verificación end-to-end + limpieza + docs

**Files:**
- Modify: `CLAUDE.md` (documentar módulo equipos en Architecture)
- Limpieza de datos de prueba

- [ ] **Step 1: Flujo completo con dos tenants**

1. Generar informe TIGO como usuario de empresa A con equipo nuevo → aparece en su lista.
2. Login usuario empresa B → `GET /api/equipos` no muestra el equipo de A.
3. Informe WOM en empresa A con mismo sitio+numero → suma al mismo equipo.
4. Backfill → contadores consistentes.

- [ ] **Step 2: Limpiar datos de prueba**

Eliminar informes TEST-EQ-01 desde la papelera de la app (o borrar entradas de `registro.json` + docx en `informes/`), re-ejecutar backfill.

- [ ] **Step 3: Documentar en CLAUDE.md**

Agregar al final de la sección Architecture:

```markdown
## Equipos (hoja de vida)

`db/equipos.js` mantiene la tabla resumen `equipos` (clave natural empresa+sitio+numero,
normalizada con `claveEquipo`). Se puebla con upsert automático (no bloqueante) en
POST `/generar` y `/generar-wom`; el historial se consulta en vivo contra los registros
de informes usando las columnas `eq_numero` (clima) y `equipo` (wom).
API: GET `/api/equipos`, GET `/api/equipos/:id/historial`, POST `/api/equipos/backfill`
(superadmin). UI: pestaña Equipos en `catalogo.html`.
```

- [ ] **Step 4: Commit final**

```bash
git add CLAUDE.md
git commit -m "Equipos: documentar modulo en CLAUDE.md"
```
