const fs = require('fs');
const path = require('path');
const { supabase, escapeLike } = require('./supabase');

const DB_FILE       = path.join(__dirname, '..', 'registro.json');
const PAPELERA_FILE = path.join(__dirname, '..', 'papelera.json');

if (!fs.existsSync(DB_FILE))       fs.writeFileSync(DB_FILE, '[]');
if (!fs.existsSync(PAPELERA_FILE)) fs.writeFileSync(PAPELERA_FILE, '[]');

function loadDBLocal()        { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));       } catch { return []; } }
function saveDBLocal(d)       { fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); }
function loadPapeleraLocal()  { try { return JSON.parse(fs.readFileSync(PAPELERA_FILE, 'utf8')); } catch { return []; } }
function savePapeleraLocal(d) { fs.writeFileSync(PAPELERA_FILE, JSON.stringify(d, null, 2)); }

const fromClima = r => ({
  id: r.id, fecha: r.fecha, fechaCreacion: r.fecha_creacion,
  codInforme: r.cod_informe, nombreSitio: r.nombre_sitio,
  codigoSitio: r.codigo_sitio, tecnico: r.tecnico,
  supervisor: r.supervisor, numOT: r.num_ot,
  photoCount: r.photo_count, filename: r.filename
});
const toClima = e => ({
  id: e.id, fecha: e.fecha, fecha_creacion: e.fechaCreacion,
  cod_informe: e.codInforme, nombre_sitio: e.nombreSitio,
  codigo_sitio: e.codigoSitio, tecnico: e.tecnico,
  supervisor: e.supervisor, num_ot: e.numOT,
  photo_count: e.photoCount, filename: e.filename
});

async function dbClimaList(q) {
  if (supabase) {
    let query = supabase.from('informes_clima')
      .select('*').order('fecha_creacion', { ascending: false });
    if (q) {
      const like = `%${escapeLike(q)}%`;
      query = query.or(`nombre_sitio.ilike.${like},cod_informe.ilike.${like},tecnico.ilike.${like},num_ot.ilike.${like}`);
    }
    const { data, error } = await query;
    if (!error) return (data || []).map(fromClima);
    console.error('dbClimaList:', error.message);
  }
  const db = loadDBLocal();
  if (!q) return db;
  const ql = q.toLowerCase();
  return db.filter(r => ['nombreSitio', 'codInforme', 'tecnico', 'numOT']
    .some(k => (r[k] || '').toLowerCase().includes(ql)));
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
    const { data, error } = await supabase.from('informes_clima').select('*').eq('id', id).single();
    if (!error && data) return fromClima(data);
  }
  return loadDBLocal().find(r => r.id === id) || null;
}

async function dbClimaDelete(id) {
  if (supabase) {
    const { error } = await supabase.from('informes_clima').delete().eq('id', id);
    if (error) console.error('dbClimaDelete:', error.message);
  } else {
    saveDBLocal(loadDBLocal().filter(r => r.id !== id));
  }
}

async function dbPapeleraList(q) {
  if (supabase) {
    let query = supabase.from('papelera_clima')
      .select('*').order('fecha_eliminado', { ascending: false });
    if (q) {
      const like = `%${escapeLike(q)}%`;
      query = query.or(`nombre_sitio.ilike.${like},cod_informe.ilike.${like},tecnico.ilike.${like}`);
    }
    const { data, error } = await query;
    if (!error) return (data || []).map(r => ({ ...fromClima(r), fechaEliminado: r.fecha_eliminado }));
    console.error('dbPapeleraList:', error.message);
  }
  const p = loadPapeleraLocal();
  if (!q) return p;
  const ql = q.toLowerCase();
  return p.filter(r => ['nombreSitio', 'codInforme', 'tecnico']
    .some(k => (r[k] || '').toLowerCase().includes(ql)));
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
    const { data, error } = await supabase.from('papelera_clima').select('*').eq('id', id).single();
    if (!error && data) return { ...fromClima(data), fechaEliminado: data.fecha_eliminado };
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

module.exports = {
  dbClimaList, dbClimaInsert, dbClimaFind, dbClimaDelete,
  dbPapeleraList, dbPapeleraInsert, dbPapeleraFind, dbPapeleraDelete, dbPapeleraClear
};
