// ── Equipos (hoja de vida de activos) ─────────────────────────────
// Tabla RESUMEN con clave natural (empresa_id, sitio, numero). El detalle
// de cada intervención vive en informes_clima / informes_wom; aquí solo
// contadores y últimos datos conocidos del equipo.
const { supabase } = require('./supabase');
const local = require('./local');

// Clave normalizada: trim + espacios colapsados + lowercase.
// Compara "SALA 1 " y "sala 1" como el mismo equipo.
function norm(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' '); }
function claveEquipo(sitio, numero) {
  return `${norm(sitio).toLowerCase()}|${norm(numero).toLowerCase()}`;
}

const fromRow = r => r && ({
  id: r.id, empresaId: r.empresa_id || null,
  sitio: r.sitio, numero: r.numero,
  tipo: r.tipo, marca: r.marca, modelo: r.modelo,
  totalIntervenciones: r.total_intervenciones || 0,
  primeraIntervencion: r.primera_intervencion,
  ultimaIntervencion: r.ultima_intervencion,
  creadoEn: r.creado_en, actualizadoEn: r.actualizado_en
});

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Crea o actualiza el equipo a partir de un informe generado.
// fecha: fecha de ejecución del informe (YYYY-MM-DD).
async function upsertDesdeInforme({ empresaId, sitio, numero, tipo, marca, modelo, fecha }) {
  const s = norm(sitio), n = norm(numero);
  if (!s || !n) return; // sin sitio o sin nº de equipo no hay identidad
  const clave = claveEquipo(s, n);
  const f = fecha || null;

  if (supabase) {
    let q = supabase.from('equipos').select('*').eq('clave', clave);
    q = empresaId ? q.eq('empresa_id', empresaId) : q.is('empresa_id', null);
    const { data: rows, error } = await q.limit(1);
    if (error) { console.error('equipos find:', error.message); return; }
    const ex = rows && rows[0];
    if (!ex) {
      const { error: e2 } = await supabase.from('equipos').insert({
        id: uuid(), empresa_id: empresaId || null, sitio: s, numero: n, clave,
        tipo: norm(tipo) || null, marca: norm(marca) || null, modelo: norm(modelo) || null,
        total_intervenciones: 1, primera_intervencion: f, ultima_intervencion: f
      });
      if (e2) console.error('equipos insert:', e2.message);
    } else {
      const fields = {
        sitio: s, numero: n,
        total_intervenciones: (ex.total_intervenciones || 0) + 1,
        actualizado_en: new Date().toISOString()
      };
      // marca/modelo/tipo: el informe más reciente manda, solo si trae valor
      if (norm(tipo))   fields.tipo   = norm(tipo);
      if (norm(marca))  fields.marca  = norm(marca);
      if (norm(modelo)) fields.modelo = norm(modelo);
      if (f && (!ex.primera_intervencion || f < ex.primera_intervencion)) fields.primera_intervencion = f;
      if (f && (!ex.ultima_intervencion  || f > ex.ultima_intervencion))  fields.ultima_intervencion = f;
      const { error: e3 } = await supabase.from('equipos').update(fields).eq('id', ex.id);
      if (e3) console.error('equipos update:', e3.message);
    }
    return;
  }

  // Local (SQLite)
  const ex = local.equipos.findByClave(empresaId || null, clave);
  if (!ex) {
    local.equipos.insert({
      empresa_id: empresaId || null, sitio: s, numero: n, clave,
      tipo: norm(tipo) || null, marca: norm(marca) || null, modelo: norm(modelo) || null,
      total_intervenciones: 1, primera_intervencion: f, ultima_intervencion: f
    });
  } else {
    const fields = { sitio: s, numero: n, total_intervenciones: (ex.total_intervenciones || 0) + 1 };
    if (norm(tipo))   fields.tipo   = norm(tipo);
    if (norm(marca))  fields.marca  = norm(marca);
    if (norm(modelo)) fields.modelo = norm(modelo);
    if (f && (!ex.primera_intervencion || f < ex.primera_intervencion)) fields.primera_intervencion = f;
    if (f && (!ex.ultima_intervencion  || f > ex.ultima_intervencion))  fields.ultima_intervencion = f;
    local.equipos.update(ex.id, fields);
  }
}

async function list() {
  if (supabase) {
    const { data, error } = await supabase.from('equipos').select('*')
      .order('ultima_intervencion', { ascending: false });
    if (error) { console.error('equipos list:', error.message); return []; }
    return (data || []).map(fromRow);
  }
  return local.equipos.list(null).map(fromRow);
}

async function findById(id) {
  if (supabase) {
    const { data, error } = await supabase.from('equipos').select('*').eq('id', id).single();
    if (error || !data) return null;
    return fromRow(data);
  }
  return fromRow(local.equipos.findById(id)) || null;
}

async function resetAll() {
  if (supabase) {
    const { error } = await supabase.from('equipos').delete().neq('id', '');
    if (error) console.error('equipos resetAll:', error.message);
    return;
  }
  local.equipos.deleteAll();
}

module.exports = { upsertDesdeInforme, list, findById, resetAll, claveEquipo, norm };
