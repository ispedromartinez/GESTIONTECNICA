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
