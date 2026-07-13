// Importa el catálogo de sitios del xlsx compartido (sitios_preventivos.xlsx
// / SITIOS.xlsx) a UNA empresa específica en Supabase. Uso una sola vez tras
// recrear la empresa dueña del catálogo (ICETEL).
//
//   node scripts/importar-sitios-empresa.js <EMPRESA_ID>
//   node scripts/importar-sitios-empresa.js --rut 77466910-8
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const sitiosDb = require('../db/sitios');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function loadXlsx() {
  const XLSX = require('xlsx');
  const file = ['sitios_preventivos.xlsx', 'SITIOS.xlsx']
    .map(f => path.join(__dirname, '..', f)).find(p => fs.existsSync(p));
  if (!file) { console.error('No se encontró sitios_preventivos.xlsx ni SITIOS.xlsx'); process.exit(1); }
  const wb = XLSX.readFile(file);
  const sheet = wb.SheetNames.find(n => /sitio/i.test(n)) || wb.SheetNames[0];
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });
  const pick = (f, ...keys) => {
    for (const k of Object.keys(f)) {
      const lk = k.trim().toLowerCase();
      if (keys.some(x => lk.includes(x))) { const v = String(f[k] ?? '').trim(); if (v) return v; }
    }
    return '';
  };
  return filas.map(f => ({
    nombre: pick(f, 'sitio', 'central', 'nodo', 'hub', 'nombre'),
    direccion: pick(f, 'direcc'),
    ciudad: pick(f, 'comuna', 'ciudad'),
    criticidad: pick(f, 'criticidad'),
    categoria: pick(f, 'categor'),
    codigo: pick(f, 'código', 'codigo', 'punto de inter')
  })).filter(s => s.nombre);
}

(async () => {
  const args = process.argv.slice(2);
  let empresaId = null;
  const rutIdx = args.indexOf('--rut');
  if (rutIdx >= 0) {
    const rut = args[rutIdx + 1];
    const { data } = await supabase.from('empresas').select('id,nombre').eq('rut_empresa', rut).maybeSingle();
    if (!data) { console.error('No existe empresa con RUT', rut); process.exit(1); }
    empresaId = data.id; console.log('Empresa:', data.nombre, empresaId);
  } else {
    empresaId = args[0];
  }
  if (!empresaId) { console.error('Falta EMPRESA_ID o --rut <rut>'); process.exit(1); }

  const sitios = loadXlsx();
  console.log(`Leídos ${sitios.length} sitios del xlsx. Importando…`);
  const r = await sitiosDb.bulkImport(empresaId, sitios);
  console.log(`Agregados: ${r.agregados}, duplicados: ${r.duplicados.length}, total en catálogo: ${r.count}`);
})();
