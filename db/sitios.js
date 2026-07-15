// ── Catálogo de sitios, aislado por empresa Y por módulo ───────────
// Cada módulo (tigo/wom/preventivo) tiene su propia lista de sitios por
// empresa. Supabase presente → tabla `sitios_catalogo` (clave natural
// empresa_id + modulo + clave). Supabase ausente → xlsx compartido de dev
// (solo preventivo, mono-empresa; el aislamiento real corre en Supabase).
const { supabase } = require('./supabase');

const MODULOS = ['tigo', 'wom', 'preventivo'];
const normModulo = m => (MODULOS.includes(m) ? m : 'preventivo');

// Clave de duplicado: mismo nombre + dirección + ciudad, normalizados.
const claveSitio = s => ['nombre', 'direccion', 'ciudad']
  .map(k => (s[k] || '').toString().trim().toLowerCase().replace(/\s+/g, ' '))
  .join('|');

const fromRow = r => ({
  nombre: r.nombre || '', direccion: r.direccion || '', ciudad: r.ciudad || '',
  criticidad: r.criticidad || '', categoria: r.categoria || '', codigo: r.codigo || ''
});
const toRow = (empresaId, modulo, s) => ({
  empresa_id: empresaId,
  modulo: normModulo(modulo),
  clave: claveSitio(s),
  nombre: (s.nombre || '').toString().trim(),
  direccion: (s.direccion || '').toString().trim(),
  ciudad: (s.ciudad || s.comuna || '').toString().trim(),
  criticidad: (s.criticidad || '').toString().trim(),
  categoria: (s.categoria || '').toString().trim(),
  codigo: (s.codigo || '').toString().trim()
});

// Fallback local (dev, sin Supabase): inyectado desde server.js (xlsx).
let localImpl = null;
function setLocalImpl(impl) { localImpl = impl; }

async function list(empresaId, modulo) {
  if (!supabase) return localImpl ? localImpl.load() : [];
  const { data, error } = await supabase.from('sitios_catalogo')
    .select('*').eq('empresa_id', empresaId).eq('modulo', normModulo(modulo)).order('nombre');
  if (error) { console.error('sitios.list:', error.message); return []; }
  return (data || []).map(fromRow);
}

async function add(empresaId, modulo, sitio) {
  const row = toRow(empresaId, modulo, sitio);
  if (!supabase) {
    const arr = localImpl.load();
    if (arr.some(s => claveSitio(s) === row.clave)) return { duplicado: true, existente: arr.find(s => claveSitio(s) === row.clave) };
    arr.push(fromRow(row)); localImpl.save(arr);
    return { sitio: fromRow(row), count: arr.length };
  }
  const { data: ya } = await supabase.from('sitios_catalogo')
    .select('*').eq('empresa_id', empresaId).eq('modulo', row.modulo).eq('clave', row.clave).maybeSingle();
  if (ya) return { duplicado: true, existente: fromRow(ya) };
  const { error } = await supabase.from('sitios_catalogo').insert(row);
  if (error) throw new Error(error.message);
  return { sitio: fromRow(row), count: await count(empresaId, modulo) };
}

async function bulkImport(empresaId, modulo, sitios) {
  const rows = sitios.map(s => toRow(empresaId, modulo, s)).filter(r => r.nombre);
  const existentes = await list(empresaId, modulo);
  const vistos = new Map(existentes.map(s => [claveSitio(s), s]));
  const agregar = [], duplicados = [];
  for (const r of rows) {
    if (vistos.has(r.clave)) { duplicados.push({ nuevo: fromRow(r), existente: vistos.get(r.clave) }); }
    else { vistos.set(r.clave, fromRow(r)); agregar.push(r); }
  }
  if (agregar.length) {
    if (!supabase) { const arr = localImpl.load(); agregar.forEach(r => arr.push(fromRow(r))); localImpl.save(arr); }
    else { const { error } = await supabase.from('sitios_catalogo').insert(agregar); if (error) throw new Error(error.message); }
  }
  return { total: rows.length, agregados: agregar.length, duplicados, count: await count(empresaId, modulo) };
}

async function resolve(empresaId, modulo, decisiones) {
  let reemplazados = 0;
  for (const d of decisiones) {
    if (d.accion !== 'reemplazar' || !d.nuevo) continue;
    const row = toRow(empresaId, modulo, d.nuevo);
    if (!supabase) {
      const arr = localImpl.load();
      const idx = arr.findIndex(s => claveSitio(s) === row.clave);
      if (idx >= 0) { arr[idx] = fromRow(row); localImpl.save(arr); reemplazados++; }
    } else {
      const { error } = await supabase.from('sitios_catalogo')
        .update(row).eq('empresa_id', empresaId).eq('modulo', row.modulo).eq('clave', row.clave);
      if (!error) reemplazados++;
    }
  }
  return { reemplazados, count: await count(empresaId, modulo) };
}

async function replaceAll(empresaId, modulo, sitios) {
  const rows = sitios.map(s => toRow(empresaId, modulo, s)).filter(r => r.nombre);
  const map = new Map(rows.map(r => [r.clave, r]));
  const unicos = [...map.values()];
  if (!supabase) { localImpl.save(unicos.map(fromRow)); return { count: unicos.length }; }
  await supabase.from('sitios_catalogo').delete().eq('empresa_id', empresaId).eq('modulo', normModulo(modulo));
  if (unicos.length) { const { error } = await supabase.from('sitios_catalogo').insert(unicos); if (error) throw new Error(error.message); }
  return { count: unicos.length };
}

async function count(empresaId, modulo) {
  if (!supabase) return localImpl ? localImpl.load().length : 0;
  const { count: c } = await supabase.from('sitios_catalogo')
    .select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('modulo', normModulo(modulo));
  return c || 0;
}

// Todas las filas de sitios con empresa/modulo (para búsqueda global).
async function listAll() {
  if (!supabase) {
    const arr = localImpl ? localImpl.load() : [];
    return arr.map(s => ({ ...fromRow(s), empresaId: s.empresa_id || null, modulo: s.modulo || null }));
  }
  const { data, error } = await supabase.from('sitios_catalogo').select('*').order('nombre');
  if (error) { console.error('sitios.listAll:', error.message); return []; }
  return (data || []).map(s => ({ ...fromRow(s), empresaId: s.empresa_id || null, modulo: s.modulo || null }));
}

module.exports = { list, listAll, add, bulkImport, resolve, replaceAll, count, claveSitio, setLocalImpl, MODULOS, normModulo };
