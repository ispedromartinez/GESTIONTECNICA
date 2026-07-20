// ════════════════════════════════════════════════════════════════
// Helpers compartidos entre los módulos de informes (Tigo, WOM y
// Preventivo). Viven en un solo lugar para evitar el tipo de drift que
// ya causó un XSS real cuando cada página tenía su propia copia de
// esc()/escArg() (ver CLAUDE.md, sección "Security rule"). Aquí el
// riesgo equivalente es duplicar la lógica de aislamiento por tenant
// (filtrarInformesPorEmpresa/puedeVerInforme) o los helpers de Storage.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { supabase } = require('../db/supabase');
const gestionDb = require('../db/gestion');
const { canAccessTenant, scopeToTenant } = require('../middleware/tenant');

const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'documentos-word';

// ── tareas_informes.json: mapea tareaId -> {informeId, filename} ──
// Solo lo usa Tigo (WOM no vincula tareaId; ver CLAUDE.md/preventivo
// usa su propia copia inline). Leído por GET /tareas/informes-map.
const TAREAS_INFORMES_FILE = path.join(__dirname, '..', 'tareas_informes.json');
if (!fs.existsSync(TAREAS_INFORMES_FILE)) fs.writeFileSync(TAREAS_INFORMES_FILE, '{}');

function loadTareasInformes() { try { return JSON.parse(fs.readFileSync(TAREAS_INFORMES_FILE,'utf8')); } catch { return {}; } }
function saveTareasInformes(m) { fs.writeFileSync(TAREAS_INFORMES_FILE, JSON.stringify(m, null, 2)); }

// ── Seguridad: sanitización de búsquedas ──────────────────────
// El texto del buscador NUNCA se interpola en SQL — viaja como
// parámetro ($1) para que el motor lo trate como dato, no como código.
function sanitizeSearch(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw
    .replace(/\0/g, '')        // null bytes (vector de ataque clásico)
    .replace(/[,()]/g, ' ')    // delimitadores de sintaxis PostgREST/SQL
    .trim()
    .slice(0, 100);            // longitud máxima — evita queries enormes
  return clean || null;
}

// Escapa wildcards de LIKE para que el texto sea literal en BD
// sin esto, buscar "50%" filtraría registros que empiecen con 50
function escapeLike(s) {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ── Aislamiento multi-tenant para informes (clima/wom/prev) ────
// Delegan en el módulo central de tenant (middleware/tenant.js): superadmin ve
// todo; el resto SOLO su propio tenant; informes legado sin tenant → solo superadmin.
function filtrarInformesPorEmpresa(rows, user) {
  return scopeToTenant({ user }, rows, r => r.empresaId);
}
// ¿Este usuario puede acceder a un informe concreto (por id)?
function puedeVerInforme(entry, user) {
  return canAccessTenant({ user }, entry && entry.empresaId);
}

// ── Supabase Storage helpers ───────────────────────────────────
async function storageUpload(buffer, storagePath, contentType) {
  if (!supabase) return;
  const { error } = await supabase.storage.from(SUPABASE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true
    });
  if (error) console.error('storageUpload error:', error.message);
}

async function storageDownload(storagePath) {
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).download(storagePath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function storageMove(fromPath, toPath) {
  if (!supabase) return;
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).move(fromPath, toPath);
  if (error) console.error('storageMove error:', error.message);
}

async function storageRemove(paths) {
  if (!supabase) return;
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove(paths);
  if (error) console.error('storageRemove error:', error.message);
}

// Vincula un informe de gestión con el documento recién generado: lo marca
// 'enviado' (generado) y guarda el enlace de descarga. Solo si el usuario es
// el técnico/supervisor asignado o admin. Nunca rompe la generación.
async function vincularInformeGestion(req, gestionInformeId, doc_url, doc_nombre) {
  if (!gestionInformeId) return;
  try {
    const inf = await gestionDb.informeById(gestionInformeId);
    if (!inf) return;
    const u = req.user || {};
    const autorizado = inf.tecnico_id === u.usuario_id || inf.supervisor_id === u.usuario_id
      || ['superadmin', 'admin_empresa'].includes(u.rol);
    if (!autorizado) return;
    await gestionDb.informeSetDocumento(gestionInformeId, doc_url, doc_nombre);
  } catch (e) { console.error('vincularInformeGestion:', e.message); }
}

module.exports = {
  loadTareasInformes, saveTareasInformes,
  sanitizeSearch, escapeLike,
  filtrarInformesPorEmpresa, puedeVerInforme,
  storageUpload, storageDownload, storageMove, storageRemove,
  vincularInformeGestion
};
