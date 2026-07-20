// ════════════════════════════════════════════════════════════════
// Módulo: Informes Preventivo (generación PDF, registro, verificación pública).
// Distinto de routes/preventivo.js, que maneja las tareas (CRUD). Este router
// es el equivalente de routes/tigo.js/routes/wom.js para el módulo Preventivo:
// genera un PDF (Puppeteer) en vez de un .docx. Almacenamiento: Supabase
// (tabla 'informes_prev'/'papelera_prev') con fallback a archivos locales
// 'registro_prev.json'/'papelera_prev.json' y documentos en './informes_prev'.
//
// A diferencia de TIGO/WOM, la papelera acá es solo de escritura (se inserta
// al borrar, pero no hay rutas para listarla/restaurar/purgarla) — hueco
// preexistente, no se completa en esta extracción.
// ════════════════════════════════════════════════════════════════
const express = require('express');
const fs = require('fs');
const path = require('path');
const { buildHtmlPreventivo } = require('../templates/preventivo-html');
const { authMiddleware } = require('../middleware/auth');
const { requireModulo } = require('../middleware/modulos');
const { supabase } = require('../db/supabase');
const {
  sanitizeSearch, escapeLike, filtrarInformesPorEmpresa, puedeVerInforme,
  vincularInformeGestion, storageUpload, storageDownload, storageMove,
  loadTareasInformes, saveTareasInformes
} = require('../utils/informesCompartido');

const router = express.Router();

// Ruta de Chrome configurable por entorno (en Linux/producción NO existe la
// ruta de Windows). Define CHROME_PATH en .env con la ubicación real.
const CHROME_PATH = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const DOCS_DIR_PREV     = path.join(__dirname, '..', 'informes_prev');
const PAPELERA_DIR_PREV = path.join(__dirname, '..', 'papelera_prev');
const DB_FILE_PREV      = path.join(__dirname, '..', 'registro_prev.json');
const PAPELERA_FILE_PREV = path.join(__dirname, '..', 'papelera_prev.json');

if (!fs.existsSync(DOCS_DIR_PREV))      fs.mkdirSync(DOCS_DIR_PREV);
if (!fs.existsSync(PAPELERA_DIR_PREV))  fs.mkdirSync(PAPELERA_DIR_PREV);
if (!fs.existsSync(DB_FILE_PREV))       fs.writeFileSync(DB_FILE_PREV, '[]');
if (!fs.existsSync(PAPELERA_FILE_PREV)) fs.writeFileSync(PAPELERA_FILE_PREV, '[]');

function loadDBPrevLocal()        { try { return JSON.parse(fs.readFileSync(DB_FILE_PREV,'utf8')); }        catch { return []; } }
function saveDBPrevLocal(d)       { fs.writeFileSync(DB_FILE_PREV, JSON.stringify(d, null, 2)); }
function loadPapaleraPrevLocal()  { try { return JSON.parse(fs.readFileSync(PAPELERA_FILE_PREV,'utf8')); }  catch { return []; } }
function savePapaleraPrevLocal(d) { fs.writeFileSync(PAPELERA_FILE_PREV, JSON.stringify(d, null, 2)); }

const fromPrev = r => ({
  id: r.id, fechaCreacion: r.fecha_creacion,
  trackerId: r.tracker_id,
  nombreNodo: r.nombre_nodo, ejecutante: r.ejecutante,
  fecha: r.fecha, tareaOfficetrack: r.tarea_officetrack,
  equipoCount: r.equipo_count, tareaId: r.tarea_id, filename: r.filename,
  empresaId: r.empresa_id || null
});
const toPrev = e => ({
  id: e.id, fecha_creacion: e.fechaCreacion,
  tracker_id: e.trackerId,
  nombre_nodo: e.nombreNodo, ejecutante: e.ejecutante,
  fecha: e.fecha, tarea_officetrack: e.tareaOfficetrack,
  equipo_count: e.equipoCount, tarea_id: e.tareaId, filename: e.filename,
  empresa_id: e.empresaId || null
});

async function dbPrevList(q) {
  if (supabase) {
    let query = supabase.from('informes_prev')
      .select('*').order('fecha_creacion', { ascending: false });
    if (q) {
      const like = `%${escapeLike(q)}%`;
      query = query.or(`nombre_nodo.ilike.${like},ejecutante.ilike.${like}`);
    }
    const { data, error } = await query;
    if (!error) return (data||[]).map(fromPrev);
    console.error('dbPrevList:', error.message);
  }
  const db = loadDBPrevLocal();
  if (!q) return db;
  const ql = q.toLowerCase();
  return db.filter(r => ['nombreNodo','ejecutante','tareaOfficetrack']
    .some(k => (r[k]||'').toLowerCase().includes(ql)));
}
async function dbPrevInsert(entry) {
  if (supabase) {
    const { error } = await supabase.from('informes_prev').insert(toPrev(entry));
    if (error) console.error('dbPrevInsert:', error.message);
  } else {
    const db = loadDBPrevLocal(); db.unshift(entry); saveDBPrevLocal(db);
  }
}
async function dbPrevFind(id) {
  if (supabase) {
    const { data, error } = await supabase.from('informes_prev')
      .select('*').eq('id', id).single();
    if (!error && data) return fromPrev(data);
  }
  return loadDBPrevLocal().find(r => r.id === id) || null;
}
async function dbPrevFindBySecId(secId) {
  if (supabase) {
    const { data, error } = await supabase.from('informes_prev')
      .select('*').eq('tarea_officetrack', secId).single();
    if (!error && data) return fromPrev(data);
  }
  return loadDBPrevLocal().find(r => r.tareaOfficetrack === secId) || null;
}
async function dbPrevDelete(id) {
  if (supabase) {
    const { error } = await supabase.from('informes_prev').delete().eq('id', id);
    if (error) console.error('dbPrevDelete:', error.message);
  } else {
    saveDBPrevLocal(loadDBPrevLocal().filter(r => r.id !== id));
  }
}
async function dbPapaleraPrevInsert(entry) {
  if (supabase) {
    const { error } = await supabase.from('papelera_prev')
      .insert({ ...toPrev(entry), deleted_at: entry.deletedAt });
    if (error) console.error('dbPapaleraPrevInsert:', error.message);
  } else {
    const p = loadPapaleraPrevLocal(); p.unshift(entry); savePapaleraPrevLocal(p);
  }
}

// ── Tracker ID (correlativo del PDF) ────────────────────────────
const TRACKER_FILE = path.join(__dirname, '..', 'tracker_prev.json');
if (!fs.existsSync(TRACKER_FILE)) fs.writeFileSync(TRACKER_FILE, JSON.stringify({last:0}));

function nextTrackerId() {
  let counter = 0;
  try { counter = JSON.parse(fs.readFileSync(TRACKER_FILE,'utf8')).last || 0; } catch{}
  counter++;
  fs.writeFileSync(TRACKER_FILE, JSON.stringify({last:counter}));
  return String(counter).padStart(3,'0');
}
function peekTrackerId() {
  let counter = 0;
  try { counter = JSON.parse(fs.readFileSync(TRACKER_FILE,'utf8')).last || 0; } catch{}
  return String(counter + 1).padStart(3,'0');
}

// Escapa texto antes de inyectarlo en HTML (evita XSS en la página pública
// de verificación).
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Build PDF Preventivo (Puppeteer + Chrome) ──────────────
async function buildPdfPreventivo(d) {
  const puppeteer = require('puppeteer-core');
  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error(`No se encontró Chrome en "${CHROME_PATH}". Configura la variable CHROME_PATH en .env con la ruta del navegador.`);
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
    headless: 'new'
  });
  try {
    const page = await browser.newPage();
    const html = buildHtmlPreventivo(d);
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    const pdf = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' }
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

router.post('/generar-preventivo', authMiddleware, requireModulo('preventivo'), async (req, res) => {
  try {
    const d = req.body;
    const trackerId = nextTrackerId();
    d.trackerId = trackerId;
    // QR para el PDF
    try {
      const QRCode = require('qrcode');
      const verUrl = `${req.protocol}://${req.get('host')}/verificar-informe?id=${encodeURIComponent(d.tareaOfficetrack||'')}`;
      d.qrDataUrl = await QRCode.toDataURL(verUrl, { width: 80, margin: 1, color: { dark: '#0F172A', light: '#ffffff' } });
    } catch(e) { d.qrDataUrl = null; }
    const buffer = await buildPdfPreventivo(d);

    // Nombre: SITIO_CRQ_SALA.pdf
    const sitio = (d.nombreNodo||'SITIO').replace(/[^a-zA-Z0-9\-]/g,'_').replace(/_+/g,'_').slice(0,35);
    const crq   = (d.crq||trackerId).replace(/[^a-zA-Z0-9\-]/g,'_').slice(0,20);
    const sala  = (d.sala||'').replace(/[^a-zA-Z0-9]/g,'_').slice(0,6);
    const fname = `${sitio}_${crq}_${sala}.pdf`;

    fs.writeFileSync(path.join(DOCS_DIR_PREV, fname), buffer);
    await storageUpload(buffer, `prev/${fname}`);

    const entry = {
      id: Date.now().toString(),
      fechaCreacion: new Date().toISOString(),
      trackerId,
      nombreNodo: d.nombreNodo, ejecutante: d.ejecutante,
      fecha: d.fecha, tareaOfficetrack: d.tareaOfficetrack,
      equipoCount: (d.equipos||[]).length,
      tareaId: d.tareaId||null, filename: fname,
      empresaId: req.user.empresa_id || null
    };
    await dbPrevInsert(entry);

    if (d.tareaId) {
      const mapa = loadTareasInformes();
      mapa[d.tareaId] = { informeId: entry.id, filename: fname, tipo: 'prev' };
      saveTareasInformes(mapa);
    }
    // Informe de gestión asignado al técnico → marcar generado + enlazar doc.
    await vincularInformeGestion(req, d.gestionInformeId, `/descargar-prev/${entry.id}`, fname);

    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${fname}"`);
    res.setHeader('Access-Control-Expose-Headers','Content-Disposition');
    res.send(buffer);
  } catch(err) { console.error(err); res.status(500).json({error:err.message}); }
});

// ── Verificación pública de informe preventivo (sin auth) ─────
router.get('/verificar-informe', async (req, res) => {
  const id = (req.query.id||'').trim();
  if (!id) return res.status(400).send('<h2>ID no proporcionado</h2>');
  const entry = await dbPrevFindBySecId(id);
  const found = !!entry;
  const color = found ? '#059669' : '#DC2626';
  const icon  = found ? '✅' : '❌';
  const title = found ? 'Informe Verificado' : 'ID No Encontrado';
  const body  = found ? `
    <div class="row"><span class="lbl">Sitio</span><span>${escapeHtml(entry.nombreNodo||'—')}</span></div>
    <div class="row"><span class="lbl">Técnico</span><span>${escapeHtml(entry.ejecutante||'—')}</span></div>
    <div class="row"><span class="lbl">Fecha</span><span>${escapeHtml(entry.fecha||'—')}</span></div>
    <div class="row"><span class="lbl">Equipos</span><span>${escapeHtml(entry.equipoCount||'—')}</span></div>
    <div class="row"><span class="lbl">Generado</span><span>${escapeHtml(entry.fechaCreacion ? new Date(entry.fechaCreacion).toLocaleString('es-CL') : '—')}</span></div>
  ` : `<p style="color:#64748B;font-size:.9rem">El ID de seguridad <strong>${escapeHtml(id)}</strong> no corresponde a ningún informe registrado.</p>`;

  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} – ICETEL</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#F0F4F9;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:1rem}
    .card{background:#fff;border-radius:24px;padding:2.5rem 2rem;max-width:420px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.1)}
    .icon{font-size:3rem;margin-bottom:.75rem}
    h1{font-size:1.25rem;font-weight:800;color:${color};margin-bottom:.5rem}
    .sec-id{font-family:monospace;font-size:.85rem;background:#F8FAFC;border:1px solid rgba(0,0,0,.08);border-radius:8px;padding:.4rem .8rem;display:inline-block;margin-bottom:1.25rem;color:#475569;letter-spacing:.04em}
    .rows{text-align:left;border-top:1px solid #F1F5F9;padding-top:1rem;display:flex;flex-direction:column;gap:.6rem}
    .row{display:flex;justify-content:space-between;gap:.5rem;font-size:.875rem}
    .lbl{color:#94A3B8;font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;padding-top:2px}
    .footer{margin-top:1.5rem;font-size:.72rem;color:#CBD5E1}
  </style></head><body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <div class="sec-id">${escapeHtml(id)}</div>
    <div class="rows">${body}</div>
    <div class="footer">ICETEL · Sistema de Informes de Mantenimiento Clima</div>
  </div>
  </body></html>`);
});

router.get('/registro-prev', authMiddleware, requireModulo('preventivo'), async (req, res) => {
  const q = sanitizeSearch(req.query.q);
  res.json(filtrarInformesPorEmpresa(await dbPrevList(q), req.user));
});

router.get('/descargar-prev/:id', authMiddleware, requireModulo('preventivo'), async (req, res) => {
  const entry = await dbPrevFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  let buffer = await storageDownload(`prev/${entry.filename}`);
  if (!buffer) {
    const fpath = path.join(DOCS_DIR_PREV, entry.filename);
    if (!fs.existsSync(fpath)) return res.status(404).json({error:'Archivo no encontrado'});
    buffer = fs.readFileSync(fpath);
  }
  const isPdf = entry.filename.endsWith('.pdf');
  res.setHeader('Content-Type', isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition',`attachment; filename="${entry.filename}"`);
  res.send(buffer);
});

router.delete('/registro-prev/:id', authMiddleware, requireModulo('preventivo'), async (req, res) => {
  const entry = await dbPrevFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  await storageMove(`prev/${entry.filename}`, `prev/papelera/${entry.filename}`);
  try {
    const fp = path.join(DOCS_DIR_PREV, entry.filename);
    if (fs.existsSync(fp)) fs.renameSync(fp, path.join(PAPELERA_DIR_PREV, entry.filename));
  } catch(e) {}
  await dbPrevDelete(entry.id);
  await dbPapaleraPrevInsert({ ...entry, deletedAt: new Date().toISOString() });
  res.json({ok:true});
});

router.dbPrevList = dbPrevList;
router.peekTrackerId = peekTrackerId;
module.exports = router;
