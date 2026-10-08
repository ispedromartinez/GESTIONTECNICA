// ════════════════════════════════════════════════════════════════
// Módulo: Informes TIGO / Clima (generación, registro, papelera).
// Almacenamiento: Supabase (tablas 'informes_clima'/'papelera_clima')
// con fallback a archivos locales 'registro.json'/'papelera.json' y
// documentos en './informes'/'./papelera'. Protegido con authMiddleware
// + requireModulo('tigo') por ruta (no hay auth global del router porque
// no todas las rutas de informes comparten exactamente el mismo gate).
// ════════════════════════════════════════════════════════════════
const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { authMiddleware } = require('../middleware/auth');
const { requireModulo } = require('../middleware/modulos');
const { requireNivel } = require('../middleware/roles');
const { supabase } = require('../db/supabase');
const equiposDb = require('../db/equipos');
const buildDocx = require('../docx/clima');
const { leerCamposClima, contarFotosClima, extraerFotosClima } = require('../docx/climaLeer');
const {
  sanitizeSearch, escapeLike, filtrarInformesPorEmpresa, puedeVerInforme,
  vincularInformeGestion, storageUpload, storageDownload, storageMove, storageRemove,
  loadTareasInformes, saveTareasInformes, nombreUnico, nombreDescarga
} = require('../utils/informesCompartido');

const router = express.Router();

const DOCS_DIR      = path.join(__dirname, '..', 'informes');
const DATOS_DIR     = path.join(DOCS_DIR, 'datos');
const PAPELERA_DIR  = path.join(__dirname, '..', 'papelera');
const DB_FILE       = path.join(__dirname, '..', 'registro.json');
const PAPELERA_FILE = path.join(__dirname, '..', 'papelera.json');

if (!fs.existsSync(DOCS_DIR))     fs.mkdirSync(DOCS_DIR);
if (!fs.existsSync(DATOS_DIR))    fs.mkdirSync(DATOS_DIR);
if (!fs.existsSync(PAPELERA_DIR)) fs.mkdirSync(PAPELERA_DIR);
if (!fs.existsSync(DB_FILE))      fs.writeFileSync(DB_FILE, '[]');
if (!fs.existsSync(PAPELERA_FILE))fs.writeFileSync(PAPELERA_FILE, '[]');

// ── Local fallback helpers ─────────────────────────────────────
function loadDBLocal()       { try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }       catch { return []; } }
function saveDBLocal(d)      { fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); }
function loadPapeleraLocal() { try { return JSON.parse(fs.readFileSync(PAPELERA_FILE,'utf8')); } catch { return []; } }
function savePapeleraLocal(d){ fs.writeFileSync(PAPELERA_FILE, JSON.stringify(d, null, 2)); }

// ── Row mappers – Clima ────────────────────────────────────────
const fromClima = r => ({
  id: r.id, fecha: r.fecha, fechaCreacion: r.fecha_creacion,
  codInforme: r.cod_informe, nombreSitio: r.nombre_sitio,
  codigoSitio: r.codigo_sitio, tecnico: r.tecnico,
  supervisor: r.supervisor, numOT: r.num_ot,
  lpu: r.lpu || null, circuito: r.circuito || null,
  photoCount: r.photo_count, filename: r.filename,
  eqNumero: r.eq_numero || null,
  empresaId: r.empresa_id || null
});
const toClima = e => ({
  id: e.id, fecha: e.fecha, fecha_creacion: e.fechaCreacion,
  cod_informe: e.codInforme, nombre_sitio: e.nombreSitio,
  codigo_sitio: e.codigoSitio, tecnico: e.tecnico,
  supervisor: e.supervisor, num_ot: e.numOT,
  lpu: e.lpu || null, circuito: e.circuito || null,
  photo_count: e.photoCount, filename: e.filename,
  eq_numero: e.eqNumero || null,
  empresa_id: e.empresaId || null
});

// ── Async DB – Informes Clima ──────────────────────────────────
async function dbClimaList(q) {
  if (supabase) {
    let query = supabase.from('informes_clima')
      .select('*').order('fecha_creacion', { ascending: false });
    if (q) {
      // El valor viaja como parámetro $1 vía PostgREST — nunca interpolado en SQL
      const like = `%${escapeLike(q)}%`;
      query = query.or(
        `nombre_sitio.ilike.${like},cod_informe.ilike.${like},tecnico.ilike.${like},num_ot.ilike.${like}`
      );
    }
    const { data, error } = await query;
    if (!error) return (data||[]).map(fromClima);
    console.error('dbClimaList:', error.message);
  }
  // Fallback JSON local: filtrado en JS puro — sin SQL, sin riesgo de inyección
  const db = loadDBLocal();
  if (!q) return db;
  const ql = q.toLowerCase();
  return db.filter(r => ['nombreSitio','codInforme','tecnico','numOT']
    .some(k => (r[k]||'').toLowerCase().includes(ql)));
}

async function dbClimaInsert(entry) {
  if (supabase) {
    const { error } = await supabase.from('informes_clima').insert(toClima(entry));
    if (error) console.error('dbClimaInsert:', error.message);
  } else {
    const db = loadDBLocal(); db.unshift(entry); saveDBLocal(db);
  }
}

async function dbClimaFind(id) {
  if (supabase) {
    const { data, error } = await supabase.from('informes_clima')
      .select('*').eq('id', id).single();
    if (!error && data) return fromClima(data);
    // Con Supabase activo, un miss es un miss: NO se cae al JSON local, que en
    // producción es un residuo obsoleto y resucitaría informes ya borrados.
    return null;
  }
  return loadDBLocal().find(r => r.id === id) || null;
}

// Actualización parcial: solo las columnas presentes en `campos` (camelCase).
// No se pasa por toClima porque rellena con null lo que no viene y pisaría
// columnas que el llamador no quiso tocar.
const COLUMNAS_CLIMA = {
  fecha: 'fecha', codInforme: 'cod_informe', nombreSitio: 'nombre_sitio',
  codigoSitio: 'codigo_sitio', tecnico: 'tecnico', supervisor: 'supervisor',
  numOT: 'num_ot', lpu: 'lpu', circuito: 'circuito', photoCount: 'photo_count',
  eqNumero: 'eq_numero'
};
async function dbClimaUpdate(id, campos) {
  if (supabase) {
    const row = {};
    for (const [k, v] of Object.entries(campos)) if (COLUMNAS_CLIMA[k]) row[COLUMNAS_CLIMA[k]] = v;
    const { error } = await supabase.from('informes_clima').update(row).eq('id', id);
    if (error) throw new Error(error.message);
  } else {
    const db = loadDBLocal();
    const i = db.findIndex(r => r.id === id);
    if (i >= 0) { db[i] = { ...db[i], ...campos }; saveDBLocal(db); }
  }
}

async function dbClimaDelete(id) {
  if (supabase) {
    const { error } = await supabase.from('informes_clima').delete().eq('id', id);
    if (error) console.error('dbClimaDelete:', error.message);
  } else {
    saveDBLocal(loadDBLocal().filter(r => r.id !== id));
  }
}

// ── Async DB – Papelera Clima ──────────────────────────────────
async function dbPapeleraList(q) {
  if (supabase) {
    let query = supabase.from('papelera_clima')
      .select('*').order('fecha_eliminado', { ascending: false });
    if (q) {
      const like = `%${escapeLike(q)}%`;
      query = query.or(
        `nombre_sitio.ilike.${like},cod_informe.ilike.${like},tecnico.ilike.${like}`
      );
    }
    const { data, error } = await query;
    if (!error) return (data||[]).map(r => ({ ...fromClima(r), fechaEliminado: r.fecha_eliminado }));
    console.error('dbPapeleraList:', error.message);
  }
  const p = loadPapeleraLocal();
  if (!q) return p;
  const ql = q.toLowerCase();
  return p.filter(r => ['nombreSitio','codInforme','tecnico']
    .some(k => (r[k]||'').toLowerCase().includes(ql)));
}

async function dbPapeleraInsert(entry) {
  if (supabase) {
    const row = { ...toClima(entry), fecha_eliminado: entry.fechaEliminado };
    const { error } = await supabase.from('papelera_clima').insert(row);
    if (error) console.error('dbPapeleraInsert:', error.message);
  } else {
    const p = loadPapeleraLocal(); p.unshift(entry); savePapeleraLocal(p);
  }
}

async function dbPapeleraFind(id) {
  if (supabase) {
    const { data, error } = await supabase.from('papelera_clima')
      .select('*').eq('id', id).single();
    if (!error && data) return { ...fromClima(data), fechaEliminado: data.fecha_eliminado };
    return null; // ver nota en dbClimaFind
  }
  return loadPapeleraLocal().find(r => r.id === id) || null;
}

async function dbPapeleraDelete(id) {
  if (supabase) {
    const { error } = await supabase.from('papelera_clima').delete().eq('id', id);
    if (error) console.error('dbPapeleraDelete:', error.message);
  } else {
    savePapeleraLocal(loadPapeleraLocal().filter(r => r.id !== id));
  }
}

async function dbPapeleraClear() {
  if (supabase) {
    const { error } = await supabase.from('papelera_clima').delete().neq('id', '');
    if (error) console.error('dbPapeleraClear:', error.message);
  } else {
    savePapeleraLocal([]);
  }
}

// ── Documento y payload completo de un informe ────────────────
async function leerDocxInforme(entry) {
  const buffer = await storageDownload(`clima/${entry.filename}`);
  if (buffer) return buffer;
  const fpath = path.join(DOCS_DIR, entry.filename);
  return fs.existsSync(fpath) ? fs.readFileSync(fpath) : null;
}

// El payload con que se generó el informe (fotos, resumen, mediciones…) se
// guarda aparte para poder reabrirlo entero en modo edición. Va a Storage
// además de a disco porque el disco del servidor en producción es efímero.
// Sin las referencias de flujo (tarea/gestión): ya cumplieron su función.
async function guardarDatosInforme(id, d) {
  try {
    const { tareaId, gestionInformeId, ...datos } = d;
    const buf = Buffer.from(JSON.stringify(datos));
    fs.writeFileSync(path.join(DATOS_DIR, `${id}.json`), buf);
    await storageUpload(buf, `clima/datos/${id}.json`, 'application/json');
  } catch (e) { console.error('guardarDatosInforme:', e.message); }
}
async function leerDatosInforme(id) {
  let buf = await storageDownload(`clima/datos/${id}.json`);
  if (!buf) {
    const fpath = path.join(DATOS_DIR, `${id}.json`);
    if (!fs.existsSync(fpath)) return null;
    buf = fs.readFileSync(fpath);
  }
  try { return JSON.parse(buf.toString('utf8')); } catch { return null; }
}

// Hoja de vida: registra/actualiza el equipo. Nunca rompe el flujo que la llama.
async function registrarEquipo(empresaId, d) {
  try {
    await equiposDb.upsertDesdeInforme({
      empresaId: empresaId || null,
      sitio: d.nombreSitio, numero: d.eqNumero,
      tipo: d.eqTipo, marca: d.eqMarca, modelo: d.eqModelo,
      fecha: d.fecha
    });
  } catch (e) { console.error('equipos upsert (clima):', e.message); }
}

// Busca el informe y verifica el acceso del usuario; responde 404/403 si no.
async function informeAccesible(req, res) {
  const entry = await dbClimaFind(req.params.id);
  if (!entry) { res.status(404).json({ error: 'No encontrado' }); return null; }
  if (!puedeVerInforme(entry, req.user)) { res.status(403).json({ error: 'Sin acceso a este informe' }); return null; }
  return entry;
}

router.post('/generar', authMiddleware, requireModulo('tigo'), async (req,res) => {
  try {
    const d = req.body;
    const buffer = await buildDocx(d);
    const id = Date.now().toString();
    const sitePart = (d.nombreSitio||'Clima').replace(/[^a-zA-Z0-9]/g,'_').slice(0,25);
    // El código viaja al nombre de archivo: solo caracteres seguros (evita
    // path traversal con ../ y roturas del header Content-Disposition).
    const codPart = (d.codInforme||'Informe').replace(/[^a-zA-Z0-9\-_]/g,'_').slice(0,40);
    // El id hace único el nombre (código+sitio se repiten); al descargar se
    // muestra sin el sufijo. Ver nombreUnico/nombreDescarga.
    const fname = nombreUnico(`${codPart}_${sitePart}`, id, 'docx');
    fs.writeFileSync(path.join(DOCS_DIR, fname), buffer);
    await storageUpload(buffer, `clima/${fname}`);

    const { photos } = d;
    const entry = {
      id,
      fecha: d.fecha, fechaCreacion: new Date().toISOString(),
      codInforme: d.codInforme, nombreSitio: d.nombreSitio,
      codigoSitio: d.codigoSitio, tecnico: d.tecnico,
      supervisor: d.supervisor, numOT: d.numOT,
      lpu: d.lpu || null, circuito: d.circuito || null,
      eqNumero: d.eqNumero || null,
      photoCount: (photos||[]).filter(Boolean).length,
      filename: fname,
      empresaId: req.user.empresa_id || null
    };
    await dbClimaInsert(entry);
    await guardarDatosInforme(id, d);
    await registrarEquipo(req.user.empresa_id, d);

    if (d.tareaId) {
      const mapa = loadTareasInformes();
      mapa[d.tareaId] = { informeId: entry.id, filename: fname };
      saveTareasInformes(mapa);
    }
    // Informe de gestión asignado al técnico → marcar generado + enlazar doc.
    await vincularInformeGestion(req, d.gestionInformeId, `/descargar/${entry.id}`, fname);

    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition',`attachment; filename="${nombreDescarga(fname)}"`);
    res.setHeader('Access-Control-Expose-Headers','Content-Disposition');
    res.send(buffer);
  } catch(err) { console.error(err); res.status(500).json({error:err.message}); }
});

router.get('/registro', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const q = sanitizeSearch(req.query.q);
  res.json(filtrarInformesPorEmpresa(await dbClimaList(q), req.user));
});

router.get('/descargar/:id', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const entry = await dbClimaFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  let buffer = await storageDownload(`clima/${entry.filename}`);
  if (!buffer) {
    const fpath = path.join(DOCS_DIR, entry.filename);
    if (!fs.existsSync(fpath)) return res.status(404).json({error:'Archivo no existe'});
    buffer = fs.readFileSync(fpath);
  }
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition',`attachment; filename="${nombreDescarga(entry.filename)}"`);
  res.send(buffer);
});

// ── Subir un .docx ya confeccionado con esta app ──────────────
// Los metadatos se leen del propio documento (docx/climaLeer.js); el archivo
// se guarda tal cual llega, sin regenerarlo. Supervisor o superior.
const SUBIR_MAX_BYTES = 20 * 1024 * 1024;
router.post('/registro/subir', authMiddleware, requireModulo('tigo'), requireNivel(2), async (req, res) => {
  try {
    const { fileName, fileBase64 } = req.body || {};
    if (!fileBase64) return res.status(400).json({ error: 'Falta el archivo .docx' });
    if (!/\.docx$/i.test(fileName || '')) return res.status(400).json({ error: 'El archivo debe ser un .docx' });
    const buffer = Buffer.from(fileBase64, 'base64');
    if (buffer.length > SUBIR_MAX_BYTES) return res.status(413).json({ error: 'El archivo supera el máximo de 20 MB.' });
    if (buffer.slice(0, 2).toString('ascii') !== 'PK') return res.status(400).json({ error: 'El archivo no es un .docx válido.' });

    let campos;
    try { campos = await leerCamposClima(buffer); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    const photoCount = await contarFotosClima(buffer);

    const id = Date.now().toString();
    const base = String(fileName).replace(/\.docx$/i, '').replace(/[^a-zA-Z0-9\-_]/g, '_').slice(0, 80) || 'Informe';
    const fname = nombreUnico(base, id, 'docx');
    fs.writeFileSync(path.join(DOCS_DIR, fname), buffer);
    await storageUpload(buffer, `clima/${fname}`);

    await dbClimaInsert({
      id, fecha: campos.fecha, fechaCreacion: new Date().toISOString(),
      codInforme: campos.codInforme, nombreSitio: campos.nombreSitio,
      codigoSitio: campos.codigoSitio, tecnico: campos.tecnico,
      supervisor: campos.supervisor, numOT: campos.numOT,
      lpu: campos.lpu || null, circuito: campos.circuito || null,
      eqNumero: campos.eqNumero || null,
      photoCount, filename: fname,
      empresaId: req.user.empresa_id || null
    });
    await registrarEquipo(req.user.empresa_id, campos);
    res.json({ ok: true, id, campos });
  } catch (e) { console.error('POST /registro/subir:', e); res.status(500).json({ error: e.message || 'Error al subir el informe' }); }
});

// Recalcula photoCount leyendo el .docx real (informes que quedaron con un
// conteo incorrecto, p. ej. subidos antes de que se contaran las fotos).
router.post('/registro/:id/recontar-fotos', authMiddleware, requireModulo('tigo'), requireNivel(2), async (req, res) => {
  try {
    const entry = await informeAccesible(req, res);
    if (!entry) return;
    const buffer = await leerDocxInforme(entry);
    if (!buffer) return res.status(404).json({ error: 'Archivo no existe' });
    const photoCount = await contarFotosClima(buffer);
    await dbClimaUpdate(entry.id, { photoCount });
    res.json({ ok: true, photoCount });
  } catch (e) { console.error('POST /registro/:id/recontar-fotos:', e); res.status(500).json({ error: e.message || 'Error al recontar fotos' }); }
});

// ── Modo edición ──────────────────────────────────────────────
// Devuelve el payload para reabrir el formulario. Si el informe no lo tiene
// guardado (generado antes de esta función, o subido), se arma leyendo el
// .docx: campos + fotos; `parcial` avisa que puede faltar algo (tickets
// vacíos, descripciones de fotos, título de portada).
router.get('/registro/:id/datos', authMiddleware, requireModulo('tigo'), requireNivel(2), async (req, res) => {
  try {
    const entry = await informeAccesible(req, res);
    if (!entry) return;
    const datos = await leerDatosInforme(entry.id);
    if (datos) return res.json({ ok: true, datos, parcial: false });
    const buffer = await leerDocxInforme(entry);
    if (!buffer) return res.status(404).json({ error: 'Archivo no existe' });
    const campos = await leerCamposClima(buffer);
    const photos = await extraerFotosClima(buffer).catch(() => []);
    res.json({ ok: true, parcial: true, datos: { ...campos, tituloPortada: '', photos, photoDescs: [] } });
  } catch (e) { console.error('GET /registro/:id/datos:', e); res.status(500).json({ error: e.message || 'Error al leer el informe' }); }
});

// Regenera el .docx del informe con el payload editado, sobre el mismo
// archivo y el mismo id. El código de informe no cambia: es el identificador
// que ve el usuario y puede estar citado en otros documentos.
router.put('/registro/:id', authMiddleware, requireModulo('tigo'), requireNivel(2), async (req, res) => {
  try {
    const entry = await informeAccesible(req, res);
    if (!entry) return;
    const d = { ...req.body, codInforme: entry.codInforme };
    const buffer = await buildDocx(d);
    fs.writeFileSync(path.join(DOCS_DIR, entry.filename), buffer);
    await storageUpload(buffer, `clima/${entry.filename}`);
    await guardarDatosInforme(entry.id, d);
    await dbClimaUpdate(entry.id, {
      fecha: d.fecha, nombreSitio: d.nombreSitio, codigoSitio: d.codigoSitio,
      tecnico: d.tecnico, supervisor: d.supervisor, numOT: d.numOT,
      lpu: d.lpu || null, circuito: d.circuito || null, eqNumero: d.eqNumero || null,
      photoCount: (d.photos || []).filter(Boolean).length
    });
    await registrarEquipo(entry.empresaId, d);
    res.json({ ok: true, id: entry.id });
  } catch (e) { console.error('PUT /registro/:id:', e); res.status(500).json({ error: e.message || 'Error al actualizar el informe' }); }
});


router.post('/enviar/:id', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const entry = await dbClimaFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  let buffer = await storageDownload(`clima/${entry.filename}`);
  if (!buffer) {
    const fpath = path.join(DOCS_DIR, entry.filename);
    if (!fs.existsSync(fpath)) return res.status(404).json({error:'Archivo no existe'});
    buffer = fs.readFileSync(fpath);
  }
  const {to,smtpHost,smtpPort,smtpUser,smtpPass} = req.body;
  if (!to) return res.status(400).json({error:'Email requerido'});
  // Anti-SSRF: el host/puerto SMTP los pone el cliente. Sin validar, esta
  // ruta autenticada sirve para sondear la red interna (169.254.169.254,
  // 127.x, 10.x, 192.168.x, etc.) o puertos arbitrarios. Se restringe a
  // puertos de correo y se bloquean destinos internos.
  const host = String(smtpHost || 'smtp.gmail.com').trim().toLowerCase();
  const port = Number(smtpPort) || 587;
  if (![25, 465, 587, 2525].includes(port))
    return res.status(400).json({error:'Puerto SMTP no permitido'});
  const esHostInterno =
    host === 'localhost' || host.endsWith('.local') ||
    /^(127\.|10\.|169\.254\.|192\.168\.|0\.0\.0\.0|::1|\[)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (esHostInterno)
    return res.status(400).json({error:'Host SMTP no permitido'});
  try {
    const t = nodemailer.createTransport({ host, port, secure: port === 465, auth:{user:smtpUser,pass:smtpPass} });
    await t.sendMail({ from:smtpUser, to, subject:`Informe - ${entry.nombreSitio} - ${entry.codInforme}`,
      text:`Adjunto informe.\nSitio: ${entry.nombreSitio}\nFecha: ${entry.fecha}\nTécnico: ${entry.tecnico}`,
      attachments:[{filename:nombreDescarga(entry.filename), content:buffer}] });
    res.json({ok:true});
  } catch(err){ res.status(500).json({error:err.message}); }
});

// Mover a papelera (soft delete)
router.delete('/registro/:id', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const entry = await dbClimaFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  await storageMove(`clima/${entry.filename}`, `clima/papelera/${entry.filename}`);
  try {
    const srcPath = path.join(DOCS_DIR, entry.filename);
    if (fs.existsSync(srcPath)) fs.renameSync(srcPath, path.join(PAPELERA_DIR, entry.filename));
  } catch(e) {}
  await dbClimaDelete(entry.id);
  await dbPapeleraInsert({ ...entry, fechaEliminado: new Date().toISOString() });
  res.json({ok:true});
});

// List papelera
router.get('/papelera', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const q = sanitizeSearch(req.query.q);
  res.json(filtrarInformesPorEmpresa(await dbPapeleraList(q), req.user));
});

// Restore from papelera
router.post('/papelera/restaurar/:id', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const entry = await dbPapeleraFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  await storageMove(`clima/papelera/${entry.filename}`, `clima/${entry.filename}`);
  try {
    const srcPath = path.join(PAPELERA_DIR, entry.filename);
    if (fs.existsSync(srcPath)) fs.renameSync(srcPath, path.join(DOCS_DIR, entry.filename));
  } catch(e) {}
  const { fechaEliminado, ...clean } = entry;
  await dbPapeleraDelete(entry.id);
  await dbClimaInsert(clean);
  res.json({ok:true});
});

// Delete permanently from papelera
router.delete('/papelera/:id', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const entry = await dbPapeleraFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  await storageRemove([`clima/papelera/${entry.filename}`, `clima/datos/${entry.id}.json`]);
  try {
    const fpath = path.join(PAPELERA_DIR, entry.filename);
    if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
    const dpath = path.join(DATOS_DIR, `${entry.id}.json`);
    if (fs.existsSync(dpath)) fs.unlinkSync(dpath);
  } catch(e) {}
  await dbPapeleraDelete(entry.id);
  res.json({ok:true});
});

// Empty papelera (solo lo de la propia empresa; superadmin vacía todo)
router.delete('/papelera', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const papelera = filtrarInformesPorEmpresa(await dbPapeleraList(null), req.user);
  if (papelera.length) {
    await storageRemove(papelera.flatMap(e => [`clima/papelera/${e.filename}`, `clima/datos/${e.id}.json`]));
    papelera.forEach(e => {
      try {
        const f = path.join(PAPELERA_DIR, e.filename); if (fs.existsSync(f)) fs.unlinkSync(f);
        const dpath = path.join(DATOS_DIR, `${e.id}.json`); if (fs.existsSync(dpath)) fs.unlinkSync(dpath);
      } catch(e2) {}
    });
  }
  if (req.user.rol === 'superadmin') await dbPapeleraClear();
  else for (const e of papelera) await dbPapeleraDelete(e.id);
  res.json({ok:true});
});

router.dbClimaList = dbClimaList;
module.exports = router;
