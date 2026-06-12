const fs = require('fs');
const path = require('path');
const { supabase, escapeLike } = require('./supabase');

const DB_FILE_WOM       = path.join(__dirname, '..', 'registro_wom.json');
const PAPELERA_FILE_WOM = path.join(__dirname, '..', 'papelera_wom.json');

if (!fs.existsSync(DB_FILE_WOM))       fs.writeFileSync(DB_FILE_WOM, '[]');
if (!fs.existsSync(PAPELERA_FILE_WOM)) fs.writeFileSync(PAPELERA_FILE_WOM, '[]');

function loadDBWomLocal()        { try { return JSON.parse(fs.readFileSync(DB_FILE_WOM, 'utf8'));        } catch { return []; } }
function saveDBWomLocal(d)       { fs.writeFileSync(DB_FILE_WOM, JSON.stringify(d, null, 2)); }
function loadPapeleraWomLocal()  { try { return JSON.parse(fs.readFileSync(PAPELERA_FILE_WOM, 'utf8')); } catch { return []; } }
function savePapeleraWomLocal(d) { fs.writeFileSync(PAPELERA_FILE_WOM, JSON.stringify(d, null, 2)); }

const fromWom = r => ({
  id: r.id, fechaCreacion: r.fecha_creacion,
  ticket: r.ticket, codInterno: r.cod_interno,
  fechaInicio: r.fecha_inicio, instalacion: r.instalacion,
  tipoActividad: r.tipo_actividad, tecnicos: r.tecnicos,
  photoCount: r.photo_count, filename: r.filename
});
const toWom = e => ({
  id: e.id, fecha_creacion: e.fechaCreacion,
  ticket: e.ticket, cod_interno: e.codInterno,
  fecha_inicio: e.fechaInicio, instalacion: e.instalacion,
  tipo_actividad: e.tipoActividad, tecnicos: e.tecnicos,
  photo_count: e.photoCount, filename: e.filename
});

async function dbWomList(q) {
  if (supabase) {
    let query = supabase.from('informes_wom')
      .select('*').order('fecha_creacion', { ascending: false });
    if (q) {
      const like = `%${escapeLike(q)}%`;
      query = query.or(`ticket.ilike.${like},cod_interno.ilike.${like},instalacion.ilike.${like}`);
    }
    const { data, error } = await query;
    if (!error) return (data || []).map(fromWom);
    console.error('dbWomList:', error.message);
  }
  const db = loadDBWomLocal();
  if (!q) return db;
  const ql = q.toLowerCase();
  return db.filter(r => ['ticket', 'codInterno', 'instalacion', 'tipoActividad']
    .some(k => (r[k] || '').toLowerCase().includes(ql)));
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
    const { data, error } = await supabase.from('informes_wom').select('*').eq('id', id).single();
    if (!error && data) return fromWom(data);
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

async function dbPapeleraWomList() {
  if (supabase) {
    const { data, error } = await supabase.from('papelera_wom')
      .select('*').order('deleted_at', { ascending: false });
    if (!error) return (data || []).map(r => ({ ...fromWom(r), deletedAt: r.deleted_at }));
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
    const { data, error } = await supabase.from('papelera_wom').select('*').eq('id', id).single();
    if (!error && data) return { ...fromWom(data), deletedAt: data.deleted_at };
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

module.exports = {
  dbWomList, dbWomInsert, dbWomFind, dbWomDelete,
  dbPapeleraWomList, dbPapeleraWomInsert, dbPapeleraWomFind, dbPapeleraWomDelete, dbPapeleraWomClear
};
