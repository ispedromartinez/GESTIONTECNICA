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

// Estos tests corren contra un servidor local con estado persistente
// (auth.db / *.json, no una DB efímera). Igual que en tenant-isolation.test.js,
// la creación de empresa/usuario es idempotente: si ya existe (de una corrida
// previa), se recupera su id en vez de fallar.
async function crearEmpresaIdempotente(H, nombre, rut) {
  const r = await fetch(`${BASE}/api/empresas`, { method: 'POST', headers: H,
    body: JSON.stringify({ nombre, rut_empresa: rut }) });
  if (r.ok) return (await r.json()).empresa.id;
  const lista = await fetch(`${BASE}/api/empresas`, { headers: H }).then(x => x.json());
  const found = (Array.isArray(lista) ? lista : []).find(
    x => (x.rut_empresa || '').replace(/\./g, '') === rut.replace(/\./g, ''));
  return found && found.id;
}
async function crearUsuarioIdempotente(H, empId, nombre, email, rol) {
  const r = await fetch(`${BASE}/api/usuarios`, { method: 'POST', headers: H,
    body: JSON.stringify({ nombre, email, password: 'Busq123!', rol, empresa_id: empId }) });
  if (r.ok) return (await r.json()).usuario;
  const lista = await fetch(`${BASE}/api/empresas/${empId}/usuarios`, { headers: H }).then(x => x.json());
  return (Array.isArray(lista) ? lista : []).find(u => u.email === email);
}

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

test('busqueda: scoping por técnico (supervisor ve su técnico, técnico solo lo suyo)', async () => {
  const H = { 'Content-Type': 'application/json', ...authOf(tokSuper) };
  // Empresa
  const empId = await crearEmpresaIdempotente(H, 'Busq Emp', '76500000-9');
  // Supervisor SUP y técnicos TA (asignado) y TB (ajeno)
  const sup = await crearUsuarioIdempotente(H, empId, 'Sup Uno','busq-sup@test.local','supervisor');
  const ta  = await crearUsuarioIdempotente(H, empId, 'Tec Alfa','busq-ta@test.local','tecnico');
  const tb  = await crearUsuarioIdempotente(H, empId, 'Tec Beta','busq-tb@test.local','tecnico');
  // Asignar TA al supervisor (vínculo admin)
  await fetch(`${BASE}/api/gestion/supervisores/${sup.id}/tecnicos`, { method:'POST', headers:H,
    body: JSON.stringify({ tecnico_id: ta.id }) }).catch(()=>{});
  // Activar módulo tigo + asignar TA y TB para que puedan generar
  const proy = await fetch(`${BASE}/api/empresas/${empId}/modulos`, { method:'POST', headers:H,
    body: JSON.stringify({ template:'tigo', activo:true }) }).then(r=>r.json());
  for (const t of [ta, tb]) await fetch(`${BASE}/api/gestion/proyectos/${proy.proyecto.id}/asignaciones`,
    { method:'POST', headers:H, body: JSON.stringify({ usuario_id: t.id }) }).catch(()=>{});
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

test('busqueda: aislamiento por empresa (usuario de empresa B no ve datos de empresa A)', async () => {
  const H = { 'Content-Type': 'application/json', ...authOf(tokSuper) };
  // Empresa B, separada de "Busq Emp" (empresa A del test anterior)
  const empBId = await crearEmpresaIdempotente(H, 'Busq Emp B', '76500001-7');
  await crearUsuarioIdempotente(H, empBId, 'Admin B', 'busq-adminb@test.local', 'admin_empresa');

  const login = e => fetch(`${BASE}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ email:e, password:'Busq123!' }) }).then(r=>r.json()).then(d=>d.token);
  const tokAdminB = await login('busq-adminb@test.local');

  const buscar = tok => fetch(`${BASE}/api/buscar?q=scope`, { headers: authOf(tok) }).then(r=>r.json());
  const rAdminB = await buscar(tokAdminB);
  assert.ok(!rAdminB.informes.some(i=>i.codInforme==='BUSQSCOPEA'), 'Admin B NO ve el informe de empresa A');
  assert.ok(!rAdminB.informes.some(i=>i.codInforme==='BUSQSCOPEB'), 'Admin B NO ve el informe de empresa A (TB)');
  assert.ok(!rAdminB.tecnicos.some(t=>t.nombre==='Tec Alfa'), 'Admin B NO ve el técnico de empresa A');
});

after(async () => {
  const list = await fetch(`${BASE}/registro`, { headers: authOf(tokSuper) }).then(r => r.json()).catch(() => []);
  const codigos = ['BUSQTEST01', 'BUSQSCOPEA', 'BUSQSCOPEB'];
  for (const cod of codigos) {
    const f = (Array.isArray(list) ? list : []).find(x => x.codInforme === cod);
    if (f) await fetch(`${BASE}/registro/${f.id}`, { method: 'DELETE', headers: authOf(tokSuper) }).catch(() => {});
  }
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
