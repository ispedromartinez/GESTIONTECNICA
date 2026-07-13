// Log de auditoría: quién hizo qué acción sensible y cuándo.
// Supabase presente → tabla `auditoria`. Ausente → archivo auditoria.json.
// Nunca lanza: auditar jamás debe romper la operación que se está auditando.
const fs = require('fs');
const path = require('path');
const { supabase } = require('./supabase');

const FILE = path.join(__dirname, '..', 'auditoria.json');

function loadLocal() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } }
function saveLocal(a) { try { fs.writeFileSync(FILE, JSON.stringify(a, null, 2)); } catch {} }

// Registra una acción. `req` aporta el actor (usuario del token). No bloquea:
// se llama sin await o con await tolerante; los errores solo se loguean.
async function registrar(req, accion, entidad, entidad_id, detalle) {
  const fila = {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    fecha: new Date().toISOString(),
    usuario_id: req?.user?.usuario_id || null,
    usuario_email: req?.user?.email || null,
    empresa_id: req?.user?.empresa_id || null,
    accion,                       // ej. 'crear', 'borrar', 'activar_modulo'
    entidad,                      // ej. 'empresa', 'usuario', 'proyecto'
    entidad_id: entidad_id != null ? String(entidad_id) : null,
    detalle: detalle ? JSON.stringify(detalle) : null
  };
  try {
    if (supabase) {
      const { error } = await supabase.from('auditoria').insert(fila);
      if (error) console.error('auditoria:', error.message);
    } else {
      const a = loadLocal(); a.unshift(fila); saveLocal(a.slice(0, 5000));
    }
  } catch (e) { console.error('auditoria:', e.message); }
}

// Lista el log. superadmin ve todo; admin_empresa solo su empresa.
async function listar({ empresa_id, limit = 200 } = {}) {
  if (supabase) {
    let q = supabase.from('auditoria').select('*').order('fecha', { ascending: false }).limit(limit);
    if (empresa_id) q = q.eq('empresa_id', empresa_id);
    const { data } = await q;
    return data || [];
  }
  let a = loadLocal();
  if (empresa_id) a = a.filter(x => x.empresa_id === empresa_id);
  return a.slice(0, limit);
}

module.exports = { registrar, listar };
