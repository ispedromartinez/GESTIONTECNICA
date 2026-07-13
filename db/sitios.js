// ── Catálogo de sitios de Preventivo, aislado por empresa ──────────
// Supabase presente  → tabla `sitios_catalogo` (una fila por sitio, scope
//                      por empresa_id, clave natural `clave`).
// Supabase ausente   → cae al xlsx compartido de dev (mono-empresa, solo
//                      para desarrollo local; el aislamiento real corre en
//                      Supabase/producción).
const { supabase } = require('./supabase');

// Clave de duplicado: mismo nombre + dirección + ciudad, normalizados.
const claveSitio = s => ['nombre', 'direccion', 'ciudad']
  .map(k => (s[k] || '').toString().trim().toLowerCase().replace(/\s+/g, ' '))
  .join('|');

const fromRow = r => ({
  nombre: r.nombre || '', direccion: r.direccion || '', ciudad: r.ciudad || '',
  criticidad: r.criticidad || '', categoria: r.categoria || '', codigo: r.codigo || ''
});
const toRow = (empresaId, s) => ({
  empresa_id: empresaId,
  clave: claveSitio(s),
  nombre: (s.nombre || '').toString().trim(),
  direccion: (s.direccion || '').toString().trim(),
  ciudad: (s.ciudad || s.comuna || '').toString().trim(),
  criticidad: (s.criticidad || '').toString().trim(),
  categoria: (s.categoria || '').toString().trim(),
  codigo: (s.codigo || '').toString().trim()
});

// ── Fallback local (dev, mono-empresa): usa las funciones del server ──
// Se inyectan desde server.js para no duplicar la lógica del xlsx.
let localImpl = null;
function setLocalImpl(impl) { localImpl = impl; }

async function list(empresaId) {
  if (!supabase) return localImpl ? localImpl.load() : [];
  const { data, error } = await supabase.from('sitios_catalogo')
    .select('*').eq('empresa_id', empresaId).order('nombre');
  if (error) { console.error('sitios.list:', error.message); return []; }
  return (data || []).map(fromRow);
}

// Alta individual. Devuelve { duplicado } si ya existe la misma clave.
async function add(empresaId, sitio) {
  const row = toRow(empresaId, sitio);
  if (!supabase) {
    const arr = localImpl.load();
    if (arr.some(s => claveSitio(s) === row.clave)) return { duplicado: true, existente: arr.find(s => claveSitio(s) === row.clave) };
    arr.push(fromRow(row)); localImpl.save(arr);
    return { sitio: fromRow(row), count: arr.length };
  }
  const { data: ya } = await supabase.from('sitios_catalogo')
    .select('*').eq('empresa_id', empresaId).eq('clave', row.clave).maybeSingle();
  if (ya) return { duplicado: true, existente: fromRow(ya) };
  const { error } = await supabase.from('sitios_catalogo').insert(row);
  if (error) throw new Error(error.message);
  return { sitio: fromRow(row), count: await count(empresaId) };
}

// Carga masiva: añade los no repetidos, devuelve duplicados para resolver.
async function bulkImport(empresaId, sitios) {
  const rows = sitios.map(s => toRow(empresaId, s)).filter(r => r.nombre);
  const existentes = await list(empresaId);
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
  return { total: rows.length, agregados: agregar.length, duplicados, count: await count(empresaId) };
}

// Resolver duplicados: reemplaza el existente por la versión nueva elegida.
async function resolve(empresaId, decisiones) {
  let reemplazados = 0;
  for (const d of decisiones) {
    if (d.accion !== 'reemplazar' || !d.nuevo) continue;
    const row = toRow(empresaId, d.nuevo);
    if (!supabase) {
      const arr = localImpl.load();
      const idx = arr.findIndex(s => claveSitio(s) === row.clave);
      if (idx >= 0) { arr[idx] = fromRow(row); localImpl.save(arr); reemplazados++; }
    } else {
      const { error } = await supabase.from('sitios_catalogo')
        .update(row).eq('empresa_id', empresaId).eq('clave', row.clave);
      if (!error) reemplazados++;
    }
  }
  return { reemplazados, count: await count(empresaId) };
}

// Reemplaza TODO el catálogo de la empresa por el set dado (upload de xlsx).
async function replaceAll(empresaId, sitios) {
  const rows = sitios.map(s => toRow(empresaId, s)).filter(r => r.nombre);
  // Dedup dentro del propio archivo por clave.
  const map = new Map(rows.map(r => [r.clave, r]));
  const unicos = [...map.values()];
  if (!supabase) { localImpl.save(unicos.map(fromRow)); return { count: unicos.length }; }
  await supabase.from('sitios_catalogo').delete().eq('empresa_id', empresaId);
  if (unicos.length) { const { error } = await supabase.from('sitios_catalogo').insert(unicos); if (error) throw new Error(error.message); }
  return { count: unicos.length };
}

async function count(empresaId) {
  if (!supabase) return localImpl ? localImpl.load().length : 0;
  const { count: c } = await supabase.from('sitios_catalogo')
    .select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId);
  return c || 0;
}

module.exports = { list, add, bulkImport, resolve, replaceAll, count, claveSitio, setLocalImpl };
