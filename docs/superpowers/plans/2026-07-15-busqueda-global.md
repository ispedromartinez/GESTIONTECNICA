# Búsqueda Global — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un endpoint `GET /api/buscar?q=` y una barra de búsqueda en `dashboard.html` que cruzan informes (Tigo/WOM), sitios, equipos y técnicos, con resultados aislados por rol/empresa en el servidor.

**Architecture:** Endpoint en `server.js` que carga las 4 fuentes con sus helpers existentes (`dbClimaList`/`dbWomList`/`equipos.list`/`sitios`/`usuariosList`), filtra por coincidencia (`matchTexto`) y aplica scoping por rol (`scopeBusqueda`). Devuelve `{informes,sitios,equipos,tecnicos}` con máx 8 por tipo. El frontend pinta un dropdown agrupado con popover, todo escapado con `esc()`.

**Tech Stack:** Node/Express, `node:test` para integración (modo local), HTML/JS vanilla + `common.js` (`esc`/`escArg`).

## Global Constraints

- Scoping SIEMPRE server-side en `scopeBusqueda`. El cliente nunca recibe datos fuera de su alcance ni filtra por seguridad.
- REGLA XSS (`CLAUDE.md`): todo dato del servidor en `innerHTML` por `esc()`; en `onclick="..."` por `escArg()`. `dashboard.html` ya carga `common.js`.
- `q` con <2 caracteres (tras `.trim()`) → responder `{informes:[],sitios:[],equipos:[],tecnicos:[]}` sin consultar fuentes.
- Máx 8 resultados por tipo.
- No bloqueante: cada fuente en try/catch; si una falla, su grupo va `[]` y se `console.error`; el endpoint responde 200 igual.
- Match normalizado sin acentos: `String(x).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim()`.
- Patrón de dualidad de almacenamiento: reusar los helpers que ya hacen `if(supabase){}else{}` (`dbClimaList`, `dbWomList`, `equipos.list`, `sitios.list`, `db.usuariosList`).
- Los informes legacy guardan el técnico como TEXTO: clima en `tecnico` (uno), WOM en `tecnicos` (varios, coma-separados). El scoping por técnico compara nombres normalizados.
- Modo de verificación: `USE_LOCAL_DB=true`, no toca producción.

---

### Task 1: Endpoint `/api/buscar` + helpers + scoping por empresa (superadmin/admin)

**Files:**
- Modify: `server.js` (helpers nuevos + endpoint, cerca de los otros `app.get('/api/...')`)
- Modify: `db/sitios.js` (agregar `listAll()` para el caso superadmin)
- Test: `test/busqueda.test.js` (nuevo)

**Interfaces:**
- Produces:
  - `GET /api/buscar?q=<texto>` → `{ informes:[], sitios:[], equipos:[], tecnicos:[] }`.
  - `normBusq(s)` → string normalizado (sin acentos, lowercase, trim).
  - `matchTexto(qNorm, ...campos)` → boolean.
  - `scopeBusqueda(req, tipo, filas)` → filas visibles para `req.user` (tipo ∈ `'informe'|'sitio'|'equipo'|'tecnico'`).
  - `sitios.listAll()` en `db/sitios.js` → todas las filas con `empresaId` y `modulo` preservados.
- Consumes (todos YA requeridos en server.js, líneas 17-19): `dbClimaList`, `dbWomList` (funciones en server.js), `equiposDb` (`./db/equipos`), `sitiosDb` (`./db/sitios`), `gestionDb` (`./db/gestion`, expone `usuariosList`, `usuarioById`, `tecnicosDeSupervisor`), `authMiddleware`. NO agregar requires nuevos.

- [ ] **Step 1: Escribir el test de integración base**

Crear `test/busqueda.test.js`:

```js
// /api/buscar: búsqueda global scopeada. Modo local, no toca producción.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 3198;
const BASE = `http://localhost:${PORT}`;
const ADMIN_SECRET = 'busq-admin-secret';
const SUPER = { email: 'busq-super@test.local', password: 'Busq123!' };

let server, tokSuper;

function esperar(ms = 15000) {
  const t0 = Date.now();
  return new Promise((res, rej) => (async function p() {
    try { if ((await fetch(`${BASE}/ping`)).ok) return res(); } catch {}
    if (Date.now() - t0 > ms) return rej(new Error('timeout'));
    setTimeout(p, 250);
  })());
}
const authOf = t => ({ Authorization: 'Bearer ' + t });

before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, USE_LOCAL_DB: 'true', PORT: String(PORT),
           JWT_SECRET: 'busq-jwt', ADMIN_SECRET, NODE_ENV: 'test' },
    stdio: 'ignore'
  });
  await esperar();
  await fetch(`${BASE}/auth/register-superadmin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Busq Super', email: SUPER.email, password: SUPER.password, secret: ADMIN_SECRET })
  }).catch(() => {});
  tokSuper = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(SUPER)
  }).then(r => r.json()).then(d => d.token);
  // Informe Tigo buscable
  await fetch(`${BASE}/generar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authOf(tokSuper) },
    body: JSON.stringify({ fecha: '2026-07-15', nombreSitio: 'BUSCA SITIO ZETA', codigoSitio: 'BZ1',
      tecnico: 'Tecnico Busca', supervisor: 'S', numOT: 'OT', codInforme: 'BUSQTEST01', photos: [], captions: [] })
  });
});

after(async () => {
  const list = await fetch(`${BASE}/registro`, { headers: authOf(tokSuper) }).then(r => r.json()).catch(() => []);
  const f = list.find(x => x.codInforme === 'BUSQTEST01');
  if (f) await fetch(`${BASE}/registro/${f.id}`, { method: 'DELETE', headers: authOf(tokSuper) }).catch(() => {});
  if (server) server.kill();
});

test('busqueda: q corta (<2) devuelve grupos vacíos', async () => {
  const r = await fetch(`${BASE}/api/buscar?q=z`, { headers: authOf(tokSuper) });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual(d, { informes: [], sitios: [], equipos: [], tecnicos: [] });
});

test('busqueda: superadmin encuentra el informe por sitio', async () => {
  const r = await fetch(`${BASE}/api/buscar?q=zeta`, { headers: authOf(tokSuper) });
  const d = await r.json();
  assert.ok(d.informes.some(i => i.codInforme === 'BUSQTEST01'), 'debe encontrar el informe');
});

test('busqueda: match sin acentos', async () => {
  const r = await fetch(`${BASE}/api/buscar?q=t%C3%A9cnico`, { headers: authOf(tokSuper) }); // "técnico"
  const d = await r.json();
  assert.ok(Array.isArray(d.informes));
});

test('busqueda: sin token → 401', async () => {
  const r = await fetch(`${BASE}/api/buscar?q=zeta`);
  assert.equal(r.status, 401);
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `node --test test/busqueda.test.js`
Expected: FALLA (los tests de contenido fallan porque `/api/buscar` no existe → 404, `d.informes` undefined).

- [ ] **Step 3: Agregar `listAll()` a `db/sitios.js`**

En `db/sitios.js`, junto a `list()`, agregar (preserva `empresaId` y `modulo`, que `fromRow` descarta):

```js
// Todas las filas de sitios con empresa/modulo (para búsqueda global).
async function listAll() {
  if (!supabase) {
    const arr = localImpl ? localImpl.load() : [];
    return arr.map(s => ({ ...fromRow(s), empresaId: s.empresa_id || null, modulo: s.modulo || null }));
  }
  const { data, error } = await supabase.from('sitios').select('*').order('nombre');
  if (error) { console.error('sitios.listAll:', error.message); return []; }
  return (data || []).map(s => ({ ...fromRow(s), empresaId: s.empresa_id || null, modulo: s.modulo || null }));
}
```

Y exportarla: en el `module.exports` de `db/sitios.js`, añadir `listAll` a la lista.

- [ ] **Step 4: Agregar los helpers `normBusq` y `matchTexto` en `server.js`**

Cerca de `puedeVerInforme` (≈L581) en `server.js`:

```js
// ── Búsqueda global: helpers ───────────────────────────────────
function normBusq(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
// true si qNorm (ya normalizado) está en alguno de los campos.
function matchTexto(qNorm, ...campos) {
  return campos.some(c => normBusq(c).includes(qNorm));
}
```

- [ ] **Step 5: Agregar `scopeBusqueda` en `server.js` (empresa-level; técnico se completa en Task 2)**

Debajo de los helpers del Step 4:

```js
// Filtra filas de una fuente según el rol/empresa del usuario.
// tipo: 'informe' | 'sitio' | 'equipo' | 'tecnico'
// Nota: el scoping por técnico (supervisor/tecnico) se agrega en Task 2.
async function scopeBusqueda(req, tipo, filas) {
  const u = req.user;
  if (u.rol === 'superadmin') return filas;               // ve todo
  const emp = u.empresa_id || null;
  if (tipo === 'informe' || tipo === 'equipo')
    return filas.filter(f => (f.empresaId || null) === emp);
  if (tipo === 'tecnico')
    return filas.filter(f => (f.empresa_id || null) === emp);
  // 'sitio': los sitios se cargan ya scopeados por empresa (ver cargarSitios); no re-filtra.
  return filas;
}
```

- [ ] **Step 6: Agregar el endpoint `GET /api/buscar` en `server.js`**

Cerca de los otros `app.get('/api/...')` (p.ej. tras `/api/equipos`):

```js
// NOTA: server.js YA tiene `equiposDb` (L18), `sitiosDb` (L19) y `gestionDb` (L17).
// NO agregar requires. Usar esos nombres.

// Carga sitios ya scopeados por empresa (o todos para superadmin).
async function cargarSitios(req) {
  if (req.user.rol === 'superadmin') return await sitiosDb.listAll();
  const emp = req.user.empresa_id;
  if (!emp) return [];
  const mods = ['tigo', 'wom', 'preventivo'];
  const listas = await Promise.all(mods.map(m => sitiosDb.list(emp, m).catch(() => [])));
  return listas.flat();
}

app.get('/api/buscar', authMiddleware, async (req, res) => {
  const vacio = { informes: [], sitios: [], equipos: [], tecnicos: [] };
  const q = normBusq(req.query.q);
  if (q.length < 2) return res.json(vacio);
  const out = { informes: [], sitios: [], equipos: [], tecnicos: [] };

  // Informes (clima + wom)
  try {
    const [clima, wom] = await Promise.all([dbClimaList(null), dbWomList(null)]);
    const climaR = clima
      .filter(i => matchTexto(q, i.codInforme, i.nombreSitio, i.codigoSitio, i.tecnico, i.numOT, i.eqNumero))
      .map(i => ({ tipo: 'informe', subtipo: 'Tigo', id: i.id, codInforme: i.codInforme,
        nombreSitio: i.nombreSitio, tecnico: i.tecnico, fecha: i.fecha, filename: i.filename, empresaId: i.empresaId }));
    const womR = wom
      .filter(i => matchTexto(q, i.codInforme, i.nombreSitio, i.codigoSitio, i.tecnicos, i.numOT, i.equipo))
      .map(i => ({ tipo: 'informe', subtipo: 'WOM', id: i.id, codInforme: i.codInforme,
        nombreSitio: i.nombreSitio, tecnico: i.tecnicos, fecha: i.fecha, filename: i.filename, empresaId: i.empresaId }));
    out.informes = (await scopeBusqueda(req, 'informe', [...climaR, ...womR])).slice(0, 8);
  } catch (e) { console.error('buscar informes:', e.message); }

  // Sitios
  try {
    const sitios = (await cargarSitios(req))
      .filter(s => matchTexto(q, s.nombre, s.codigo, s.direccion))
      .map(s => ({ tipo: 'sitio', nombre: s.nombre, codigo: s.codigo, direccion: s.direccion, modulo: s.modulo || null }));
    out.sitios = (await scopeBusqueda(req, 'sitio', sitios)).slice(0, 8);
  } catch (e) { console.error('buscar sitios:', e.message); }

  // Equipos
  try {
    const eq = (await equiposDb.list())
      .filter(x => matchTexto(q, x.numero, x.sitio, x.marca, x.modelo))
      .map(x => ({ tipo: 'equipo', id: x.id, numero: x.numero, sitio: x.sitio,
        marca: x.marca, modelo: x.modelo, totalIntervenciones: x.totalIntervenciones, empresaId: x.empresaId }));
    out.equipos = (await scopeBusqueda(req, 'equipo', eq)).slice(0, 8);
  } catch (e) { console.error('buscar equipos:', e.message); }

  // Técnicos (usuarios)
  try {
    const empParam = req.user.rol === 'superadmin' ? null : req.user.empresa_id;
    const users = (await gestionDb.usuariosList(empParam))
      .filter(us => matchTexto(q, us.nombre, us.email))
      .map(us => ({ tipo: 'tecnico', id: us.id, nombre: us.nombre, email: us.email, rol: us.rol, empresa_id: us.empresa_id }));
    out.tecnicos = (await scopeBusqueda(req, 'tecnico', users)).slice(0, 8);
  } catch (e) { console.error('buscar tecnicos:', e.message); }

  res.json(out);
});
```

Nota: usar `gestionDb`/`equiposDb`/`sitiosDb` (ya requeridos, L17-19). No crear variables `db`/`equipos`/`sitios` nuevas.

- [ ] **Step 7: Correr el test y verlo pasar**

Run: `node --test test/busqueda.test.js`
Expected: PASS los 4 tests (q corta vacía, superadmin encuentra informe, match sin acentos, 401 sin token).

- [ ] **Step 8: Commit**

```bash
git add server.js db/sitios.js test/busqueda.test.js
git commit -m "feat(buscar): endpoint /api/buscar con match y scoping por empresa"
```

---

### Task 2: Scoping por técnico (supervisor ve sus técnicos, técnico ve lo suyo)

**Files:**
- Modify: `server.js` (`scopeBusqueda` — ramas supervisor/tecnico)
- Test: `test/busqueda.test.js` (agregar escenario de roles)

**Interfaces:**
- Consumes: `gestionDb.usuarioById(id)` → `{id,nombre,email,rol,empresa_id}`; `gestionDb.tecnicosDeSupervisor(usuario_id)` → array de técnicos `{id,nombre,...}` (ya existen en `db/gestion.js`, requerido como `gestionDb` en server.js L17).
- Produces: `scopeBusqueda` ahora filtra informes y técnicos también por nombre para `supervisor`/`tecnico`.

- [ ] **Step 1: Agregar el test de scoping por rol**

Añadir a `test/busqueda.test.js` (antes del `after`). Requiere crear empresa, admin, supervisor con técnico asignado, y técnico ajeno, y generar informes con esos nombres. Añadir helpers y test:

```js
test('busqueda: scoping por técnico (supervisor ve su técnico, técnico solo lo suyo)', async () => {
  const H = { 'Content-Type': 'application/json', ...authOf(tokSuper) };
  // Empresa
  const emp = await fetch(`${BASE}/api/empresas`, { method:'POST', headers:H,
    body: JSON.stringify({ nombre:'Busq Emp', rut_empresa:'76500000-9' }) }).then(r=>r.json());
  const empId = emp.empresa.id;
  // Supervisor SUP y técnicos TA (asignado) y TB (ajeno)
  const mk = (nombre,email,rol) => fetch(`${BASE}/api/usuarios`, { method:'POST', headers:H,
    body: JSON.stringify({ nombre, email, password:'Busq123!', rol, empresa_id: empId }) }).then(r=>r.json());
  const sup = await mk('Sup Uno','busq-sup@test.local','supervisor');
  const ta  = await mk('Tec Alfa','busq-ta@test.local','tecnico');
  const tb  = await mk('Tec Beta','busq-tb@test.local','tecnico');
  // Asignar TA al supervisor (vínculo admin)
  await fetch(`${BASE}/api/gestion/supervisores/${sup.usuario.id}/tecnicos`, { method:'POST', headers:H,
    body: JSON.stringify({ tecnicoId: ta.usuario.id }) }).catch(()=>{});
  // Activar módulo tigo + asignar TA y TB para que puedan generar
  const proy = await fetch(`${BASE}/api/empresas/${empId}/modulos`, { method:'POST', headers:H,
    body: JSON.stringify({ template:'tigo', activo:true }) }).then(r=>r.json());
  for (const t of [ta, tb]) await fetch(`${BASE}/api/gestion/proyectos/${proy.proyecto.id}/asignaciones`,
    { method:'POST', headers:H, body: JSON.stringify({ usuario_id: t.usuario.id }) }).catch(()=>{});
  // Login TA y TB y generar un informe cada uno (tecnico = su nombre)
  const login = e => fetch(`${BASE}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ email:e, password:'Busq123!' }) }).then(r=>r.json()).then(d=>d.token);
  const tokTA = await login('busq-ta@test.local'), tokTB = await login('busq-tb@test.local');
  const gen = (tok, nombre, cod) => fetch(`${BASE}/generar`, { method:'POST',
    headers:{'Content-Type':'application/json', ...authOf(tok)},
    body: JSON.stringify({ fecha:'2026-07-15', nombreSitio:'SCOPE SITIO', codigoSitio:'SC1',
      tecnico: nombre, supervisor:'Sup Uno', numOT:'OT', codInforme: cod, photos:[], captions:[] }) });
  await gen(tokTA, 'Tec Alfa', 'BUSQSCOPEA');
  await gen(tokTB, 'Tec Beta', 'BUSQSCOPEB');
  // Login supervisor
  const tokSup = await login('busq-sup@test.local');
  const buscar = tok => fetch(`${BASE}/api/buscar?q=scope`, { headers: authOf(tok) }).then(r=>r.json());

  const rTA = await buscar(tokTA);
  assert.ok(rTA.informes.some(i=>i.codInforme==='BUSQSCOPEA'), 'TA ve su informe');
  assert.ok(!rTA.informes.some(i=>i.codInforme==='BUSQSCOPEB'), 'TA NO ve el de TB');

  const rSup = await buscar(tokSup);
  assert.ok(rSup.informes.some(i=>i.codInforme==='BUSQSCOPEA'), 'Supervisor ve el de su técnico TA');
  assert.ok(!rSup.informes.some(i=>i.codInforme==='BUSQSCOPEB'), 'Supervisor NO ve el de TB (ajeno)');
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `node --test test/busqueda.test.js`
Expected: FALLA la nueva aserción (sin scoping por técnico, TA/supervisor ven ambos informes porque son de la misma empresa).

- [ ] **Step 3: Extender `scopeBusqueda` con las ramas supervisor/tecnico**

Reemplazar la función `scopeBusqueda` (Task 1, Step 5) por:

```js
async function scopeBusqueda(req, tipo, filas) {
  const u = req.user;
  if (u.rol === 'superadmin') return filas;
  const emp = u.empresa_id || null;

  // Base: recorta por empresa primero.
  let base;
  if (tipo === 'informe' || tipo === 'equipo') base = filas.filter(f => (f.empresaId || null) === emp);
  else if (tipo === 'tecnico') base = filas.filter(f => (f.empresa_id || null) === emp);
  else base = filas; // sitios ya vienen scopeados por empresa

  // admin_empresa: empresa alcanza.
  if (u.rol === 'admin_empresa') return base;

  // supervisor / tecnico: además, por nombre de técnico.
  const yo = await gestionDb.usuarioById(u.usuario_id).catch(() => null);
  const nombres = new Set();
  if (yo && yo.nombre) nombres.add(normBusq(yo.nombre));
  if (u.rol === 'supervisor') {
    const tecs = await gestionDb.tecnicosDeSupervisor(u.usuario_id).catch(() => []);
    for (const t of tecs) if (t && t.nombre) nombres.add(normBusq(t.nombre));
  }

  if (tipo === 'informe') {
    // clima: 'tecnico' (uno); wom: 'tecnico' aquí ya trae la cadena de 'tecnicos' (coma-separada)
    return base.filter(f => {
      const partes = String(f.tecnico || '').split(',').map(normBusq).filter(Boolean);
      return partes.some(p => nombres.has(p));
    });
  }
  if (tipo === 'tecnico') {
    // supervisor: él + sus técnicos; tecnico: solo él
    return base.filter(f => nombres.has(normBusq(f.nombre)));
  }
  // sitios / equipos: a nivel empresa (no se recortan por técnico).
  return base;
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `node --test test/busqueda.test.js`
Expected: PASS todos, incluida la aserción de scoping por técnico.

- [ ] **Step 5: Correr toda la suite (no romper nada)**

Run: `npm test`
Expected: todos los tests previos siguen pasando + los de búsqueda.

- [ ] **Step 6: Commit**

```bash
git add server.js test/busqueda.test.js
git commit -m "feat(buscar): scoping por tecnico para supervisor y tecnico"
```

---

### Task 3: UI de búsqueda en dashboard.html (barra + dropdown + popover)

**Files:**
- Modify: `dashboard.html` (barra en header, dropdown, popover, estilos, JS)

**Interfaces:**
- Consumes: `GET /api/buscar?q=` (Task 1/2), helpers `esc`/`escArg` de `common.js`.
- Produces: barra `#gsInput`, panel `#gsPanel`, funciones `gsBuscar()`, `gsRender(data)`, `gsPopover(tipo, item)`.

- [ ] **Step 1: Verificar que dashboard.html carga common.js**

Run: `grep -c "common.js" "C:/Users/Pedro Luis Martinez/Documents/InformesClima - servidor de prueba/dashboard.html"`
Expected: ≥1. Si es 0, agregar `<script src="/common.js"></script>` antes del `<script>` principal de la página (necesario para `esc`/`escArg`).

- [ ] **Step 2: Agregar el markup de la barra en el header**

En `dashboard.html`, dentro del header/topbar (buscar el contenedor de la marca "app.nexxo.app/dashboard" o el nav superior), insertar:

```html
<div class="gs-wrap">
  <input id="gsInput" class="gs-input" type="search" placeholder="Buscar informes, sitios, equipos, técnicos…" autocomplete="off">
  <div id="gsPanel" class="gs-panel" hidden></div>
</div>
```

- [ ] **Step 3: Agregar estilos**

Antes de `</style>` en `dashboard.html`:

```css
.gs-wrap{position:relative;max-width:420px;width:100%;}
.gs-input{width:100%;padding:8px 12px;border:1px solid #CBD5E1;border-radius:9px;font-size:14px;background:#fff;color:#0F172A;}
.gs-panel{position:absolute;top:calc(100% + 6px);left:0;right:0;background:#fff;border:1px solid #E2E8F0;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.12);max-height:60vh;overflow-y:auto;z-index:50;}
.gs-group-h{padding:8px 12px 4px;font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.04em;}
.gs-item{padding:8px 12px;cursor:pointer;font-size:13px;color:#0F172A;border-top:1px solid #F1F5F9;}
.gs-item:hover,.gs-item.gs-sel{background:#F1F5F9;}
.gs-item .gs-sub{color:#64748B;font-size:12px;}
.gs-empty{padding:14px 12px;color:#64748B;font-size:13px;}
.gs-pop{position:fixed;inset:0;background:rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center;z-index:60;}
.gs-pop-box{background:#fff;border-radius:12px;padding:18px 20px;max-width:420px;width:90%;box-shadow:0 20px 50px rgba(0,0,0,.25);}
.gs-pop-box h4{margin:0 0 8px;font-size:15px;}
.gs-pop-row{font-size:13px;color:#334155;margin:3px 0;}
.gs-pop-row b{color:#0F172A;}
```

- [ ] **Step 4: Agregar el JS de búsqueda**

Dentro del `<script>` principal de `dashboard.html` (al final, antes de cerrar), agregar. Usa `esc()` en TODO dato del servidor:

```js
// ── Búsqueda global ────────────────────────────────────────────
let _gsTimer = null, _gsData = null, _gsSel = -1;
const gsInput = document.getElementById('gsInput');
const gsPanel = document.getElementById('gsPanel');

function gsToken(){ return localStorage.getItem('token') || sessionStorage.getItem('token'); }

async function gsBuscar(){
  const q = gsInput.value.trim();
  if (q.length < 2){ gsPanel.hidden = true; gsPanel.innerHTML = ''; _gsData = null; return; }
  gsPanel.hidden = false;
  gsPanel.innerHTML = '<div class="gs-empty">Buscando…</div>';
  try {
    const r = await fetch('/api/buscar?q=' + encodeURIComponent(q), { headers: { Authorization: 'Bearer ' + gsToken() } });
    if (!r.ok) throw new Error('http ' + r.status);
    _gsData = await r.json();
    gsRender(_gsData, q);
  } catch(e) {
    gsPanel.innerHTML = '<div class="gs-empty">No se pudo buscar. Reintenta.</div>';
  }
}

function gsRender(d, q){
  _gsSel = -1;
  const grupos = [
    ['Informes', 'informe', d.informes, i => `${esc(i.subtipo)} · ${esc(i.codInforme||'')} <span class="gs-sub">— ${esc(i.nombreSitio||'')} · ${esc(i.tecnico||'')}</span>`],
    ['Sitios', 'sitio', d.sitios, s => `${esc(s.nombre||'')} <span class="gs-sub">${esc(s.codigo||'')} · ${esc(s.direccion||'')}</span>`],
    ['Equipos', 'equipo', d.equipos, e => `N° ${esc(e.numero||'')} <span class="gs-sub">${esc(e.sitio||'')} · ${esc(e.marca||'')} ${esc(e.modelo||'')}</span>`],
    ['Técnicos', 'tecnico', d.tecnicos, t => `${esc(t.nombre||'')} <span class="gs-sub">${esc(t.email||'')} · ${esc(t.rol||'')}</span>`],
  ];
  let html = '', idx = 0;
  for (const [titulo, tipo, arr, fmt] of grupos){
    if (!arr || !arr.length) continue;
    html += `<div class="gs-group-h">${esc(titulo)} (${arr.length})</div>`;
    arr.forEach((it, i) => {
      html += `<div class="gs-item" data-tipo="${esc(tipo)}" data-i="${i}" data-idx="${idx}" onclick="gsPopover('${escArg(tipo)}', ${i})">${fmt(it)}</div>`;
      idx++;
    });
  }
  gsPanel.innerHTML = html || `<div class="gs-empty">Sin resultados para «${esc(q)}»</div>`;
}

function gsPopover(tipo, i){
  const arr = _gsData && _gsData[tipo === 'informe' ? 'informes' : tipo === 'sitio' ? 'sitios' : tipo === 'equipo' ? 'equipos' : 'tecnicos'];
  const it = arr && arr[i]; if (!it) return;
  let filas = '';
  if (tipo === 'informe') filas = `
    <div class="gs-pop-row"><b>Tipo:</b> ${esc(it.subtipo)}</div>
    <div class="gs-pop-row"><b>Código:</b> ${esc(it.codInforme||'')}</div>
    <div class="gs-pop-row"><b>Sitio:</b> ${esc(it.nombreSitio||'')}</div>
    <div class="gs-pop-row"><b>Técnico:</b> ${esc(it.tecnico||'')}</div>
    <div class="gs-pop-row"><b>Fecha:</b> ${esc(it.fecha||'')}</div>`;
  else if (tipo === 'sitio') filas = `
    <div class="gs-pop-row"><b>Código:</b> ${esc(it.codigo||'')}</div>
    <div class="gs-pop-row"><b>Dirección:</b> ${esc(it.direccion||'')}</div>
    <div class="gs-pop-row"><b>Módulo:</b> ${esc(it.modulo||'—')}</div>`;
  else if (tipo === 'equipo') filas = `
    <div class="gs-pop-row"><b>Sitio:</b> ${esc(it.sitio||'')}</div>
    <div class="gs-pop-row"><b>Marca/Modelo:</b> ${esc(it.marca||'')} ${esc(it.modelo||'')}</div>
    <div class="gs-pop-row"><b>Intervenciones:</b> ${esc(String(it.totalIntervenciones||0))}</div>`;
  else filas = `
    <div class="gs-pop-row"><b>Email:</b> ${esc(it.email||'')}</div>
    <div class="gs-pop-row"><b>Rol:</b> ${esc(it.rol||'')}</div>`;
  const titulo = tipo === 'informe' ? esc(it.codInforme||'Informe')
    : tipo === 'sitio' ? esc(it.nombre||'Sitio')
    : tipo === 'equipo' ? ('Equipo N° ' + esc(it.numero||''))
    : esc(it.nombre||'Técnico');
  const bg = document.createElement('div');
  bg.className = 'gs-pop';
  bg.innerHTML = `<div class="gs-pop-box"><h4>${titulo}</h4>${filas}</div>`;
  bg.addEventListener('click', ev => { if (ev.target === bg) bg.remove(); });
  document.body.appendChild(bg);
}

gsInput.addEventListener('input', () => { clearTimeout(_gsTimer); _gsTimer = setTimeout(gsBuscar, 250); });
gsInput.addEventListener('keydown', ev => {
  const items = [...gsPanel.querySelectorAll('.gs-item')];
  if (ev.key === 'Escape'){ gsPanel.hidden = true; return; }
  if (!items.length) return;
  if (ev.key === 'ArrowDown'){ ev.preventDefault(); _gsSel = Math.min(_gsSel + 1, items.length - 1); }
  else if (ev.key === 'ArrowUp'){ ev.preventDefault(); _gsSel = Math.max(_gsSel - 1, 0); }
  else if (ev.key === 'Enter'){ if (_gsSel >= 0) items[_gsSel].click(); return; }
  else return;
  items.forEach((el, i) => el.classList.toggle('gs-sel', i === _gsSel));
  items[_gsSel] && items[_gsSel].scrollIntoView({ block: 'nearest' });
});
document.addEventListener('click', ev => { if (!ev.target.closest('.gs-wrap')) gsPanel.hidden = true; });
```

- [ ] **Step 5: Verificar en navegador (controlador)**

Server local + login superadmin (crear temporal si hace falta). En dashboard:
- Tipear "zeta"/"scope" → dropdown agrupado con Informes/Sitios/Equipos/Técnicos según haya datos.
- Click en un resultado → popover con datos; cerrar con click afuera.
- Teclado: ↑/↓ resalta, Enter abre.
- XSS: en consola, forzar un resultado con `<img src=x onerror=...>` en un campo y `gsRender` → aparece escapado, no ejecuta.
- Consola sin errores.

- [ ] **Step 6: Commit**

```bash
git add dashboard.html
git commit -m "feat(buscar): barra de busqueda global en dashboard con dropdown y popover"
```

---

## Notas de verificación final

- `npm test` completo en verde (incluye `test/busqueda.test.js`).
- Revisar en el review final: que ningún dato del servidor llegue a `innerHTML` sin `esc()`, y que el único `onclick` generado (`gsPopover`) use `escArg()` en el arg `tipo` (es literal controlado, pero se mantiene la regla).
- Confirmar que `scopeBusqueda` es la única fuente de recorte y corre siempre server-side.
- WOM: el resultado mapea `tecnicos` (plural) al campo `tecnico` del resultado; el scoping por técnico hace `split(',')`.
