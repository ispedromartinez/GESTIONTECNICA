// /api/reportes: la vista consolidada muestra los informes generados de la
// empresa y respeta el aislamiento. Modo local, no toca producción.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 3197;
const BASE = `http://localhost:${PORT}`;
const ADMIN_SECRET = 'rep-admin-secret';
const SUPER = { email: 'rep-super@test.local', password: 'Rep123!' };
const COD = 'REPTEST01';

let server, tok;

function esperar(ms = 15000) {
  const t0 = Date.now();
  return new Promise((res, rej) => (async function p() {
    try { if ((await fetch(`${BASE}/ping`)).ok) return res(); } catch {}
    if (Date.now() - t0 > ms) return rej(new Error('timeout'));
    setTimeout(p, 250);
  })());
}
const auth = () => ({ Authorization: 'Bearer ' + tok });

before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, USE_LOCAL_DB: 'true', PORT: String(PORT),
           JWT_SECRET: 'rep-jwt', ADMIN_SECRET, NODE_ENV: 'test' },
    stdio: 'ignore'
  });
  await esperar();
  await fetch(`${BASE}/auth/register-superadmin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Rep', email: SUPER.email, password: SUPER.password, secret: ADMIN_SECRET })
  }).catch(() => {});
  tok = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(SUPER)
  }).then(r => r.json()).then(d => d.token);
  // Genera un informe Tigo para que aparezca en reportes.
  await fetch(`${BASE}/generar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify({ fecha: '2026-07-13', nombreSitio: 'REP SITIO', codigoSitio: 'R1',
      tecnico: 'Tecnico Rep', supervisor: 'S', numOT: 'OT', codInforme: COD, photos: [], captions: [] })
  });
});

after(async () => {
  // Limpia el informe generado.
  const list = await fetch(`${BASE}/registro`, { headers: auth() }).then(r => r.json()).catch(() => []);
  const found = list.find(x => x.codInforme === COD);
  if (found) await fetch(`${BASE}/registro/${found.id}`, { method: 'DELETE', headers: auth() }).catch(() => {});
  if (server) server.kill();
});

test('reportes: el informe generado aparece', async () => {
  const r = await fetch(`${BASE}/api/reportes`, { headers: auth() });
  assert.equal(r.status, 200);
  const { reportes, stats } = await r.json();
  assert.ok(stats.total >= 1, 'stats.total debería incluir el informe');
  const found = reportes.find(x => x.codigo === COD);
  assert.ok(found, 'el informe generado no está en reportes');
  assert.equal(found.modulo, 'tigo');
  assert.equal(found.sitio, 'REP SITIO');
  assert.match(found.descargaUrl, /^\/descargar\//);
});

test('reportes: filtro por modulo=wom excluye el informe tigo', async () => {
  const r = await fetch(`${BASE}/api/reportes?modulo=wom`, { headers: auth() });
  const { reportes } = await r.json();
  assert.ok(!reportes.find(x => x.codigo === COD), 'no debería aparecer bajo modulo=wom');
});
