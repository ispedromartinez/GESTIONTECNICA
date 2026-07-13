// Smoke tests: arrancan el server en modo LOCAL (USE_LOCAL_DB=true, SQLite/JSON),
// nunca tocan Supabase/producción. Cubren los flujos críticos que antes solo
// se verificaban a mano: salud, auth, generación Tigo/WOM, aislamiento básico.
//
//   npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const ADMIN_SECRET = 'smoke-admin-secret';
const EMAIL = 'smoke-super@test.local';
const PASS = 'Smoke123!';

let server, TOKEN;
const creados = [];    // ids de informes tigo a limpiar
const creadosWom = []; // ids de informes wom a limpiar

function esperarServer(ms = 15000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    (async function poll() {
      try {
        const r = await fetch(`${BASE}/ping`);
        if (r.ok) return resolve();
      } catch {}
      if (Date.now() - t0 > ms) return reject(new Error('server no respondió /ping a tiempo'));
      setTimeout(poll, 250);
    })();
  });
}

before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, USE_LOCAL_DB: 'true', PORT: String(PORT),
           JWT_SECRET: 'smoke-jwt-secret', ADMIN_SECRET, NODE_ENV: 'test' },
    stdio: 'ignore'
  });
  await esperarServer();

  // Superadmin idempotente: si ya existe (corridas previas), solo se ignora.
  await fetch(`${BASE}/auth/register-superadmin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Smoke', email: EMAIL, password: PASS, secret: ADMIN_SECRET })
  }).catch(() => {});

  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS })
  });
  const d = await r.json();
  TOKEN = d.token;
});

after(async () => {
  // Limpia los informes creados por el test (tigo y wom).
  for (const id of creados) {
    await fetch(`${BASE}/registro/${id}`, { method: 'DELETE',
      headers: { Authorization: 'Bearer ' + TOKEN } }).catch(() => {});
  }
  for (const id of creadosWom) {
    await fetch(`${BASE}/registro-wom/${id}`, { method: 'DELETE',
      headers: { Authorization: 'Bearer ' + TOKEN } }).catch(() => {});
  }
  if (server) server.kill();
});

const auth = (extra = {}) => ({ Authorization: 'Bearer ' + TOKEN, ...extra });

test('salud: /ping responde ok', async () => {
  const r = await fetch(`${BASE}/ping`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('auth: login devolvió token', () => {
  assert.ok(TOKEN && TOKEN.length > 20, 'sin token');
});

test('auth: ruta protegida sin token → 401', async () => {
  const r = await fetch(`${BASE}/registro`);
  assert.equal(r.status, 401);
});

test('auth: login con password incorrecta → 401', async () => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: 'malo' })
  });
  assert.equal(r.status, 401);
});

test('tigo: generar informe → 200 y devuelve .docx', async () => {
  const r = await fetch(`${BASE}/generar`, {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ fecha: '2026-07-13', nombreSitio: 'SMOKE SITIO',
      codigoSitio: 'SMK01', tecnico: 'T', supervisor: 'S', numOT: 'OT-SMK',
      codInforme: 'SMOKETIGO01', photos: [], captions: [] })
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /wordprocessingml/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.ok(buf.length > 5000, 'docx demasiado chico');
});

test('tigo: el informe aparece en /registro', async () => {
  const r = await fetch(`${BASE}/registro`, { headers: auth() });
  assert.equal(r.status, 200);
  const list = await r.json();
  const found = list.find(x => x.codInforme === 'SMOKETIGO01');
  assert.ok(found, 'informe generado no está en el historial');
  if (found) creados.push(found.id);
});

test('wom: generar informe → 200 y devuelve .docx', async () => {
  const r = await fetch(`${BASE}/generar-wom`, {
    method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ticket: 'SMOKEWOM01', codInterno: '1',
      fechaInicio: '13-07-2026', instalacion: 'RSO CONCEPCION',
      tipoActividad: 'Inspección', tecnicos: ['T'], photos: [], captions: [] })
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /wordprocessingml/);
  const rl = await fetch(`${BASE}/registro-wom`, { headers: auth() });
  const found = (await rl.json()).find(x => x.ticket === 'SMOKEWOM01');
  if (found) creadosWom.push(found.id);
});
