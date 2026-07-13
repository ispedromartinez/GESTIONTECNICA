// SLA preventivo: verifica la clasificación (a_tiempo/tarde/vencida/en_plazo)
// y el % de cumplimiento contra el endpoint /tareas/sla. Modo local.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 3196;
const BASE = `http://localhost:${PORT}`;
const ADMIN_SECRET = 'sla-secret';
const SUPER = { email: 'sla-super@test.local', password: 'Sla123!' };

let server, tok;
const creadas = [];

function esperar(ms = 15000) {
  const t0 = Date.now();
  return new Promise((res, rej) => (async function p() {
    try { if ((await fetch(`${BASE}/ping`)).ok) return res(); } catch {}
    if (Date.now() - t0 > ms) return rej(new Error('timeout'));
    setTimeout(p, 250);
  })());
}
const auth = (x = {}) => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, ...x });
const iso = d => new Date(d).toISOString().slice(0, 10);
const HOY = new Date();
const ayer = iso(HOY.getTime() - 864e5);
const manana = iso(HOY.getTime() + 864e5);
const anteayer = iso(HOY.getTime() - 2 * 864e5);

async function crearTarea(t) {
  const r = await fetch(`${BASE}/tareas`, { method: 'POST', headers: auth(), body: JSON.stringify(t) });
  const d = await r.json();
  if (d && d.id) creadas.push(d.id);
  return d;
}
// Fuerza estado + fecha de cambio (para simular cierres a tiempo/tarde).
async function setEstado(id, estado) {
  await fetch(`${BASE}/tareas/${id}/estado`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ estado }) });
}

before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, USE_LOCAL_DB: 'true', PORT: String(PORT), JWT_SECRET: 'sla-jwt', ADMIN_SECRET, NODE_ENV: 'test' },
    stdio: 'ignore'
  });
  await esperar();
  await fetch(`${BASE}/auth/register-superadmin`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Sla', email: SUPER.email, password: SUPER.password, secret: ADMIN_SECRET }) }).catch(() => {});
  tok = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(SUPER) }).then(r => r.json()).then(d => d.token);

  // Tarea VENCIDA: abierta, venció ayer.
  await crearTarea({ tareaNumero: 'SLA-VENC', tecnico: 'Tec SLA', sitio: 'Sitio X', estado: 'Nuevo', fechaVencimiento: ayer });
  // Tarea EN PLAZO: abierta, vence mañana.
  await crearTarea({ tareaNumero: 'SLA-PLAZO', tecnico: 'Tec SLA', sitio: 'Sitio X', estado: 'Nuevo', fechaVencimiento: manana });
  // Tarea A TIEMPO: cerrada hoy, vencía mañana → cierre <= vencimiento.
  const at = await crearTarea({ tareaNumero: 'SLA-OK', tecnico: 'Tec SLA', sitio: 'Sitio Y', estado: 'Nuevo', fechaVencimiento: manana });
  await setEstado(at.id, 'Cerrado');
  // Tarea TARDE: cerrada hoy, vencía anteayer → cierre > vencimiento.
  const tr = await crearTarea({ tareaNumero: 'SLA-LATE', tecnico: 'Tec SLA', sitio: 'Sitio Y', estado: 'Nuevo', fechaVencimiento: anteayer });
  await setEstado(tr.id, 'Cerrado');
});

after(async () => {
  for (const id of creadas) await fetch(`${BASE}/tareas/${id}`, { method: 'DELETE', headers: auth() }).catch(() => {});
  if (server) server.kill();
});

test('SLA: clasifica a_tiempo/tarde/vencida/en_plazo y calcula %', async () => {
  const r = await fetch(`${BASE}/tareas/sla`, { headers: { Authorization: 'Bearer ' + tok } });
  assert.equal(r.status, 200);
  const { global } = await r.json();
  assert.equal(global.a_tiempo, 1, 'a_tiempo');
  assert.equal(global.tarde, 1, 'tarde');
  assert.equal(global.vencida, 1, 'vencida');
  assert.equal(global.en_plazo, 1, 'en_plazo');
  // SLA = a_tiempo / (a_tiempo+tarde+vencida) = 1/3 = 33%.
  assert.equal(global.sla, 33);
});

test('SLA: desglose por técnico presente', async () => {
  const r = await fetch(`${BASE}/tareas/sla`, { headers: { Authorization: 'Bearer ' + tok } });
  const { porTecnico } = await r.json();
  const tec = porTecnico.find(x => x.nombre === 'Tec SLA');
  assert.ok(tec, 'técnico no está en el desglose');
  assert.equal(tec.total, 4);
});
