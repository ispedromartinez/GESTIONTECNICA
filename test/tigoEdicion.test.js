// Modo edición, subir .docx y recontar fotos (routes/tigo.js). Arranca el
// server en modo LOCAL (USE_LOCAL_DB=true), nunca toca Supabase/producción.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const buildDocx = require('../docx/clima');
const { leerCamposClima } = require('../docx/climaLeer');

const PORT = 3195;
const BASE = `http://localhost:${PORT}`;
const ADMIN_SECRET = 'edicion-admin-secret';
const EMAIL = 'smoke-super@test.local';
const PASS = 'Smoke123!';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let server, TOKEN;
const creados = [];

function esperarServer(ms = 15000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    (async function poll() {
      try { if ((await fetch(`${BASE}/ping`)).ok) return resolve(); } catch {}
      if (Date.now() - t0 > ms) return reject(new Error('server no respondió /ping a tiempo'));
      setTimeout(poll, 250);
    })();
  });
}

const auth = (extra = {}) => ({ Authorization: 'Bearer ' + TOKEN, ...extra });
const json = (method, body) => ({ method, headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });

before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, USE_LOCAL_DB: 'true', PORT: String(PORT),
           JWT_SECRET: 'edicion-jwt-secret', ADMIN_SECRET, NODE_ENV: 'test' },
    stdio: 'ignore'
  });
  await esperarServer();
  await fetch(`${BASE}/auth/register-superadmin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Smoke', email: EMAIL, password: PASS, secret: ADMIN_SECRET })
  }).catch(() => {});
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS })
  });
  TOKEN = (await r.json()).token;
});

after(async () => {
  // A la papelera y de ahí definitivo: no deja residuos en registro/papelera.json.
  for (const id of creados) {
    await fetch(`${BASE}/registro/${id}`, { method: 'DELETE', headers: auth() }).catch(() => {});
    await fetch(`${BASE}/papelera/${id}`, { method: 'DELETE', headers: auth() }).catch(() => {});
  }
  if (server) server.kill();
});

async function idPorCodigo(cod) {
  const lista = await (await fetch(`${BASE}/registro`, { headers: auth() })).json();
  return (lista.find(x => x.codInforme === cod) || {}).id;
}

test('edición: GET datos devuelve el payload completo con que se generó', async () => {
  const cod = 'EDIT-' + Date.now();
  const r = await fetch(`${BASE}/generar`, json('POST', {
    codInforme: cod, nombreSitio: 'Sitio Edición', fecha: '01-10-2026',
    tecnico: 'Tec Original', resumen: 'Original.', photos: [PNG], photoDescs: ['Foto uno'],
    ticketTE: 'TE-99'
  }));
  assert.equal(r.status, 200);
  const id = await idPorCodigo(cod);
  assert.ok(id, 'el informe no apareció en /registro');
  creados.push(id);

  const d = await (await fetch(`${BASE}/registro/${id}/datos`, { headers: auth() })).json();
  assert.equal(d.parcial, false);
  assert.equal(d.datos.tecnico, 'Tec Original');
  assert.equal(d.datos.ticketTE, 'TE-99');
  assert.deepEqual(d.datos.photoDescs, ['Foto uno']);
  assert.equal(d.datos.photos.length, 1);
});

test('edición: PUT regenera el mismo informe, conserva el código y actualiza el registro', async () => {
  const id = creados[0];
  const { datos } = await (await fetch(`${BASE}/registro/${id}/datos`, { headers: auth() })).json();
  const r = await fetch(`${BASE}/registro/${id}`, json('PUT', {
    ...datos, codInforme: 'INTENTO-CAMBIAR', tecnico: 'Tec Editado', photos: [PNG, PNG]
  }));
  assert.equal(r.status, 200);

  const lista = await (await fetch(`${BASE}/registro`, { headers: auth() })).json();
  const e = lista.find(x => x.id === id);
  assert.equal(e.tecnico, 'Tec Editado');
  assert.equal(e.codInforme, datos.codInforme, 'el código no debe cambiar');
  assert.equal(e.photoCount, 2);

  const doc = Buffer.from(await (await fetch(`${BASE}/descargar/${id}`, { headers: auth() })).arrayBuffer());
  const leido = await leerCamposClima(doc);
  assert.equal(leido.tecnico, 'Tec Editado');
  assert.equal(leido.codInforme, datos.codInforme);
});

test('recontar fotos: cuenta las del documento real', async () => {
  const r = await fetch(`${BASE}/registro/${creados[0]}/recontar-fotos`, { method: 'POST', headers: auth() });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).photoCount, 2);
});

test('subir .docx: lee los datos del documento y lo agrega al historial', async () => {
  const cod = 'SUB-' + Date.now();
  const buf = await buildDocx({ codInforme: cod, nombreSitio: 'Sitio Subido', tecnico: 'Tec Sub', fecha: '03-10-2026', photos: [PNG] });
  const r = await fetch(`${BASE}/registro/subir`, json('POST', { fileName: 'mi informe.docx', fileBase64: buf.toString('base64') }));
  assert.equal(r.status, 200);
  const d = await r.json();
  creados.push(d.id);
  assert.equal(d.campos.codInforme, cod);

  const lista = await (await fetch(`${BASE}/registro`, { headers: auth() })).json();
  const e = lista.find(x => x.id === d.id);
  assert.equal(e.nombreSitio, 'Sitio Subido');
  assert.equal(e.photoCount, 1);

  // Un informe subido no tiene payload guardado: se reabre leyendo el .docx.
  const dd = await (await fetch(`${BASE}/registro/${d.id}/datos`, { headers: auth() })).json();
  assert.equal(dd.parcial, true);
  assert.equal(dd.datos.tecnico, 'Tec Sub');
  assert.equal(dd.datos.photos.length, 1);
});

test('subir .docx: rechaza lo que no es un .docx de esta app', async () => {
  const noZip = await fetch(`${BASE}/registro/subir`, json('POST', { fileName: 'x.docx', fileBase64: Buffer.from('hola').toString('base64') }));
  assert.equal(noZip.status, 400);
  const noDocx = await fetch(`${BASE}/registro/subir`, json('POST', { fileName: 'x.pdf', fileBase64: 'AAAA' }));
  assert.equal(noDocx.status, 400);
});

test('edición: sin token → 401; id inexistente → 404', async () => {
  assert.equal((await fetch(`${BASE}/registro/${creados[0]}/datos`)).status, 401);
  assert.equal((await fetch(`${BASE}/registro/999/datos`, { headers: auth() })).status, 404);
});
