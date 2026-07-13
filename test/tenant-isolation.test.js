// Aislamiento multi-tenant: verifica por la API que el admin de una empresa
// NO puede leer datos de otra empresa. Este es el control de seguridad real
// (el backend usa service_role, así que RLS no aplica; el límite lo pone el
// filtro empresa_id en las rutas). Corre en modo local, no toca producción.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 3198;
const BASE = `http://localhost:${PORT}`;
const ADMIN_SECRET = 'iso-admin-secret';
const SUPER = { email: 'iso-super@test.local', password: 'Iso123!' };
// RUTs válidos (dígito verificador correcto) para pasar validarRut.
const EMP_A = { nombre: 'Empresa A Iso', rut: '76086428-5' };
const EMP_B = { nombre: 'Empresa B Iso', rut: '77466910-8' };

let server, superTok, adminBTok, empAId;

function esperar(ms = 15000) {
  const t0 = Date.now();
  return new Promise((res, rej) => (async function p() {
    try { if ((await fetch(`${BASE}/ping`)).ok) return res(); } catch {}
    if (Date.now() - t0 > ms) return rej(new Error('server timeout'));
    setTimeout(p, 250);
  })());
}
const j = (tok, body, method = 'POST') => ({
  method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
  body: body ? JSON.stringify(body) : undefined
});
async function login(email, password) {
  const r = await fetch(`${BASE}/auth/login`, j(null, { email, password }));
  return (await r.json()).token;
}
// Crea empresa (o recupera su id si ya existe por RUT en corridas previas).
async function crearEmpresa(tok, e) {
  const r = await fetch(`${BASE}/api/empresas`, j(tok, { nombre: e.nombre, rut_empresa: e.rut }));
  if (r.ok) return (await r.json()).empresa.id;
  const lista = await fetch(`${BASE}/api/empresas`, { headers: { Authorization: 'Bearer ' + tok } }).then(x => x.json());
  const found = lista.find(x => (x.rut_empresa || '').replace(/\./g, '') === e.rut.replace(/\./g, ''));
  return found && found.id;
}

before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, USE_LOCAL_DB: 'true', PORT: String(PORT),
           JWT_SECRET: 'iso-jwt', ADMIN_SECRET, NODE_ENV: 'test' },
    stdio: 'ignore'
  });
  await esperar();
  await fetch(`${BASE}/auth/register-superadmin`, j(null,
    { nombre: 'Iso', email: SUPER.email, password: SUPER.password, secret: ADMIN_SECRET })).catch(() => {});
  superTok = await login(SUPER.email, SUPER.password);

  empAId = await crearEmpresa(superTok, EMP_A);
  const empBId = await crearEmpresa(superTok, EMP_B);

  // Admin de la empresa B (con quien intentaremos cruzar a la A).
  await fetch(`${BASE}/api/usuarios`, j(superTok, {
    nombre: 'Admin B', email: 'iso-adminb@test.local', password: 'Iso123!',
    rol: 'admin_empresa', empresa_id: empBId
  })).catch(() => {});
  adminBTok = await login('iso-adminb@test.local', 'Iso123!');
});

after(() => { if (server) server.kill(); });

test('setup: tokens y empresa A existen', () => {
  assert.ok(superTok, 'sin token superadmin');
  assert.ok(adminBTok, 'sin token admin B');
  assert.ok(empAId, 'empresa A no creada');
});

test('aislamiento: admin B NO puede ver el detalle de empresa A → 403', async () => {
  const r = await fetch(`${BASE}/api/empresas/${empAId}`, { headers: { Authorization: 'Bearer ' + adminBTok } });
  assert.equal(r.status, 403);
});

test('aislamiento: admin B NO puede listar usuarios de empresa A → 403', async () => {
  const r = await fetch(`${BASE}/api/empresas/${empAId}/usuarios`, { headers: { Authorization: 'Bearer ' + adminBTok } });
  assert.equal(r.status, 403);
});

test('aislamiento: admin B NO puede listar proyectos de empresa A → 403', async () => {
  const r = await fetch(`${BASE}/api/empresas/${empAId}/proyectos`, { headers: { Authorization: 'Bearer ' + adminBTok } });
  assert.equal(r.status, 403);
});

test('superadmin SÍ puede ver empresa A (control positivo) → 200', async () => {
  const r = await fetch(`${BASE}/api/empresas/${empAId}`, { headers: { Authorization: 'Bearer ' + superTok } });
  assert.equal(r.status, 200);
});
