// ════════════════════════════════════════════════════════════════
// Módulo: Informes WOM (generación, registro, papelera).
// Almacenamiento: Supabase (tablas 'informes_wom'/'papelera_wom') con
// fallback a archivos locales 'registro_wom.json'/'papelera_wom.json'
// y documentos en './informes_wom'/'./papelera_wom'. Protegido con
// authMiddleware + requireModulo('wom') por ruta (excepto los 2
// endpoints de catálogo estático, que son públicos).
//
// Asimetrías conocidas respecto a Tigo (routes/tigo.js), preservadas
// intencionalmente en esta extracción — no son bugs a corregir aquí:
// WOM no vincula tareaId a tareas_informes.json, y no tiene un
// equivalente a POST /enviar/:id (envío por email).
// ════════════════════════════════════════════════════════════════
const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middleware/auth');
const { requireModulo } = require('../middleware/modulos');
const { supabase } = require('../db/supabase');
const equiposDb = require('../db/equipos');
const buildDocxWom = require('../docx/wom');
const {
  sanitizeSearch, escapeLike, filtrarInformesPorEmpresa, puedeVerInforme,
  vincularInformeGestion, storageUpload, storageDownload, storageMove, storageRemove,
  nombreUnico, nombreDescarga
} = require('../utils/informesCompartido');

const router = express.Router();

const DOCS_DIR_WOM      = path.join(__dirname, '..', 'informes_wom');
const PAPELERA_DIR_WOM  = path.join(__dirname, '..', 'papelera_wom');
const DB_FILE_WOM       = path.join(__dirname, '..', 'registro_wom.json');
const PAPELERA_FILE_WOM = path.join(__dirname, '..', 'papelera_wom.json');

if (!fs.existsSync(DOCS_DIR_WOM))      fs.mkdirSync(DOCS_DIR_WOM);
if (!fs.existsSync(PAPELERA_DIR_WOM))  fs.mkdirSync(PAPELERA_DIR_WOM);
if (!fs.existsSync(DB_FILE_WOM))       fs.writeFileSync(DB_FILE_WOM, '[]');
if (!fs.existsSync(PAPELERA_FILE_WOM)) fs.writeFileSync(PAPELERA_FILE_WOM, '[]');

// ── Local fallback helpers WOM ─────────────────────────────────
function loadDBWomLocal()        { try { return JSON.parse(fs.readFileSync(DB_FILE_WOM,'utf8')); }        catch { return []; } }
function saveDBWomLocal(d)       { fs.writeFileSync(DB_FILE_WOM, JSON.stringify(d, null, 2)); }
function loadPapeleraWomLocal()  { try { return JSON.parse(fs.readFileSync(PAPELERA_FILE_WOM,'utf8')); }  catch { return []; } }
function savePapeleraWomLocal(d) { fs.writeFileSync(PAPELERA_FILE_WOM, JSON.stringify(d, null, 2)); }

// ── Row mappers – WOM ──────────────────────────────────────────
const fromWom = r => ({
  id: r.id, fechaCreacion: r.fecha_creacion,
  ticket: r.ticket, codInterno: r.cod_interno,
  fechaInicio: r.fecha_inicio, instalacion: r.instalacion,
  tipoActividad: r.tipo_actividad, tecnicos: r.tecnicos,
  photoCount: r.photo_count, filename: r.filename,
  equipo: r.equipo || null,
  empresaId: r.empresa_id || null
});
const toWom = e => ({
  id: e.id, fecha_creacion: e.fechaCreacion,
  ticket: e.ticket, cod_interno: e.codInterno,
  fecha_inicio: e.fechaInicio, instalacion: e.instalacion,
  tipo_actividad: e.tipoActividad, tecnicos: e.tecnicos,
  photo_count: e.photoCount, filename: e.filename,
  equipo: e.equipo || null,
  empresa_id: e.empresaId || null
});

// ── Async DB – Informes WOM ────────────────────────────────────
async function dbWomList(q) {
  if (supabase) {
    let query = supabase.from('informes_wom')
      .select('*').order('fecha_creacion', { ascending: false });
    if (q) {
      const like = `%${escapeLike(q)}%`;
      query = query.or(
        `ticket.ilike.${like},cod_interno.ilike.${like},instalacion.ilike.${like}`
      );
    }
    const { data, error } = await query;
    if (!error) return (data||[]).map(fromWom);
    console.error('dbWomList:', error.message);
  }
  const db = loadDBWomLocal();
  if (!q) return db;
  const ql = q.toLowerCase();
  return db.filter(r => ['ticket','codInterno','instalacion','tipoActividad']
    .some(k => (r[k]||'').toLowerCase().includes(ql)));
}

async function dbWomInsert(entry) {
  if (supabase) {
    const { error } = await supabase.from('informes_wom').insert(toWom(entry));
    if (error) console.error('dbWomInsert:', error.message);
  } else {
    const db = loadDBWomLocal(); db.unshift(entry); saveDBWomLocal(db);
  }
}

async function dbWomFind(id) {
  if (supabase) {
    const { data, error } = await supabase.from('informes_wom')
      .select('*').eq('id', id).single();
    if (!error && data) return fromWom(data);
    // Con Supabase activo, un miss es un miss: NO se cae al JSON local, que en
    // producción es un residuo obsoleto y resucitaría informes ya borrados.
    return null;
  }
  return loadDBWomLocal().find(r => r.id === id) || null;
}

async function dbWomDelete(id) {
  if (supabase) {
    const { error } = await supabase.from('informes_wom').delete().eq('id', id);
    if (error) console.error('dbWomDelete:', error.message);
  } else {
    saveDBWomLocal(loadDBWomLocal().filter(r => r.id !== id));
  }
}

// ── Async DB – Papelera WOM ────────────────────────────────────
async function dbPapeleraWomList() {
  if (supabase) {
    const { data, error } = await supabase.from('papelera_wom')
      .select('*').order('deleted_at', { ascending: false });
    if (!error) return (data||[]).map(r => ({ ...fromWom(r), deletedAt: r.deleted_at }));
    console.error('dbPapeleraWomList:', error.message);
  }
  return loadPapeleraWomLocal();
}

async function dbPapeleraWomInsert(entry) {
  if (supabase) {
    const { error } = await supabase.from('papelera_wom')
      .insert({ ...toWom(entry), deleted_at: entry.deletedAt });
    if (error) console.error('dbPapeleraWomInsert:', error.message);
  } else {
    const p = loadPapeleraWomLocal(); p.unshift(entry); savePapeleraWomLocal(p);
  }
}

async function dbPapeleraWomFind(id) {
  if (supabase) {
    const { data, error } = await supabase.from('papelera_wom')
      .select('*').eq('id', id).single();
    if (!error && data) return { ...fromWom(data), deletedAt: data.deleted_at };
    return null; // ver nota en dbWomFind
  }
  return loadPapeleraWomLocal().find(r => r.id === id) || null;
}

async function dbPapeleraWomDelete(id) {
  if (supabase) {
    const { error } = await supabase.from('papelera_wom').delete().eq('id', id);
    if (error) console.error('dbPapeleraWomDelete:', error.message);
  } else {
    savePapeleraWomLocal(loadPapeleraWomLocal().filter(r => r.id !== id));
  }
}

async function dbPapeleraWomClear() {
  if (supabase) {
    const { error } = await supabase.from('papelera_wom').delete().neq('id', '');
    if (error) console.error('dbPapeleraWomClear:', error.message);
  } else {
    savePapeleraWomLocal([]);
  }
}

const RSO_SITES = {
  'RSO CONCEPCION':   'ANIBAL PINTO 105, CONCEPCION',
  'RSO ANTOFAGASTA':  'FELIX GARCIA 581, ANTOFAGASTA',
  'RSO PUERTO MONTT': 'AV LO CELIS S/N PUERTO MONTT',
  'RSO PUNTA ARENAS': 'AV PDTE EDUARDO FREI MONTALVA 5, PUNTA ARENAS'
};

const ACTIVIDADES_WOM = [
  'Trabajo Correctivo',
  'Mantenimiento preventivo',
  'Atención de emergencia',
  'Inspección',
  'Retiro de equipos'
];


// ── WOM Routes ─────────────────────────────────────────────────
router.get('/sitios-rso', (_req, res) => res.json(RSO_SITES));
router.get('/actividades-wom', (_req, res) => res.json(ACTIVIDADES_WOM));

router.post('/generar-wom', authMiddleware, requireModulo('wom'), async (req, res) => {
  try {
    const d = req.body;
    const buffer = await buildDocxWom(d);
    const id = Date.now().toString();
    const ticket = (d.ticket||'WOM').replace(/[^a-zA-Z0-9\-_]/g,'_').slice(0,50);
    // El id hace único el nombre (el ticket se repite); al descargar se muestra
    // sin el sufijo. Ver nombreUnico/nombreDescarga.
    const fname  = nombreUnico(`${ticket}_WOM`, id, 'docx');
    fs.writeFileSync(path.join(DOCS_DIR_WOM, fname), buffer);
    await storageUpload(buffer, `wom/${fname}`);

    const { photos, captions } = d;
    const entry = {
      id,
      fechaCreacion: new Date().toISOString(),
      ticket: d.ticket, codInterno: d.codInterno,
      fechaInicio: d.fechaInicio, instalacion: d.instalacion,
      tipoActividad: d.tipoActividad,
      equipo: d.equipo || null,
      tecnicos: (d.tecnicos||[]).filter(Boolean).join(', '),
      photoCount: (photos||[]).filter(Boolean).length,
      filename: fname,
      empresaId: req.user.empresa_id || null
    };
    await dbWomInsert(entry);

    // Hoja de vida: registra/actualiza el equipo. Nunca rompe la generación.
    try {
      await equiposDb.upsertDesdeInforme({
        empresaId: req.user.empresa_id || null,
        sitio: d.instalacion, numero: d.equipo,
        marca: d.marca, modelo: d.modelo,
        fecha: d.fechaInicio
      });
    } catch (e) { console.error('equipos upsert (wom):', e.message); }
    // Informe de gestión asignado al técnico → marcar generado + enlazar doc.
    await vincularInformeGestion(req, d.gestionInformeId, `/descargar-wom/${entry.id}`, fname);

    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition',`attachment; filename="${nombreDescarga(fname)}"`);
    res.setHeader('Access-Control-Expose-Headers','Content-Disposition');
    res.send(buffer);
  } catch(err) { console.error(err); res.status(500).json({error:err.message}); }
});

router.get('/registro-wom', authMiddleware, requireModulo('wom'), async (req, res) => {
  const q = sanitizeSearch(req.query.q);
  res.json(filtrarInformesPorEmpresa(await dbWomList(q), req.user));
});

router.get('/descargar-wom/:id', authMiddleware, requireModulo('wom'), async (req, res) => {
  const entry = await dbWomFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  let buffer = await storageDownload(`wom/${entry.filename}`);
  if (!buffer) {
    const fpath = path.join(DOCS_DIR_WOM, entry.filename);
    if (!fs.existsSync(fpath)) return res.status(404).json({error:'Archivo no encontrado'});
    buffer = fs.readFileSync(fpath);
  }
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition',`attachment; filename="${nombreDescarga(entry.filename)}"`);
  res.send(buffer);
});


router.delete('/registro-wom/:id', authMiddleware, requireModulo('wom'), async (req, res) => {
  const entry = await dbWomFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  await storageMove(`wom/${entry.filename}`, `wom/papelera/${entry.filename}`);
  try {
    const fp = path.join(DOCS_DIR_WOM, entry.filename);
    if (fs.existsSync(fp)) fs.renameSync(fp, path.join(PAPELERA_DIR_WOM, entry.filename));
  } catch(e) {}
  await dbWomDelete(entry.id);
  await dbPapeleraWomInsert({ ...entry, deletedAt: new Date().toISOString() });
  res.json({ok:true});
});

router.get('/papelera-wom', authMiddleware, requireModulo('wom'), async (req, res) => res.json(filtrarInformesPorEmpresa(await dbPapeleraWomList(), req.user)));

router.post('/papelera-wom/restaurar/:id', authMiddleware, requireModulo('wom'), async (req, res) => {
  const entry = await dbPapeleraWomFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  await storageMove(`wom/papelera/${entry.filename}`, `wom/${entry.filename}`);
  try {
    const fp = path.join(PAPELERA_DIR_WOM, entry.filename);
    if (fs.existsSync(fp)) fs.renameSync(fp, path.join(DOCS_DIR_WOM, entry.filename));
  } catch(e) {}
  const { deletedAt, ...clean } = entry;
  await dbPapeleraWomDelete(entry.id);
  await dbWomInsert(clean);
  res.json({ok:true});
});

router.delete('/papelera-wom/:id', authMiddleware, requireModulo('wom'), async (req, res) => {
  const entry = await dbPapeleraWomFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  await storageRemove([`wom/papelera/${entry.filename}`]);
  try {
    const fp = path.join(PAPELERA_DIR_WOM, entry.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch(e) {}
  await dbPapeleraWomDelete(entry.id);
  res.json({ok:true});
});

router.delete('/papelera-wom', authMiddleware, requireModulo('wom'), async (req, res) => {
  const papelera = filtrarInformesPorEmpresa(await dbPapeleraWomList(), req.user);
  if (papelera.length) {
    await storageRemove(papelera.map(e => `wom/papelera/${e.filename}`));
    papelera.forEach(e => {
      try {
        const fp = path.join(PAPELERA_DIR_WOM, e.filename); if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch(e2) {}
    });
  }
  if (req.user.rol === 'superadmin') await dbPapeleraWomClear();
  else for (const e of papelera) await dbPapeleraWomDelete(e.id);
  res.json({ok:true});
});

router.dbWomList = dbWomList;
module.exports = router;
