// scripts/migrar-asignaciones-modulos-fijos.js
// Uso: node scripts/migrar-asignaciones-modulos-fijos.js
//
// Hasta ahora, Tigo/WOM/Preventivo solo exigían que la EMPRESA tuviera el
// módulo activo (middleware/modulos.js), sin asignación individual por
// usuario. Al agregar ese chequeo, este script evita bloquear a quienes ya
// venían generando informes o tienen tareas ahí: busca sus nombres en los
// registros existentes, los matchea contra usuarios activos (técnico o
// supervisor) de la misma empresa, y crea la asignación si falta.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const gestionDb = require('../db/gestion');
const { supabase } = require('../db/supabase');

const norm = s => (s || '').trim().toLowerCase();
const splitTecnicos = v => Array.isArray(v) ? v : (v || '').split(',').map(s => s.trim());
const readJson = file => { const p = path.join(__dirname, '..', file); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : []; };

async function climaRows() {
  if (supabase) {
    const { data, error } = await supabase.from('informes_clima').select('tecnico,supervisor,empresa_id');
    if (error) throw new Error('informes_clima: ' + error.message);
    return (data || []).map(r => ({ empresaId: r.empresa_id, nombres: [r.tecnico, r.supervisor] }));
  }
  return readJson('registro.json').map(r => ({ empresaId: r.empresaId || null, nombres: [r.tecnico, r.supervisor] }));
}

async function womRows() {
  if (supabase) {
    const { data, error } = await supabase.from('informes_wom').select('tecnicos,empresa_id');
    if (error) throw new Error('informes_wom: ' + error.message);
    return (data || []).map(r => ({ empresaId: r.empresa_id, nombres: splitTecnicos(r.tecnicos) }));
  }
  return readJson('registro_wom.json').map(r => ({ empresaId: r.empresaId || null, nombres: splitTecnicos(r.tecnicos) }));
}

async function tareasRows() {
  if (supabase) {
    const { data, error } = await supabase.from('tareas_preventivo').select('tecnico,empresa_id');
    if (error) throw new Error('tareas_preventivo: ' + error.message);
    return (data || []).map(r => ({ empresaId: r.empresa_id, nombres: [r.tecnico] }));
  }
  return readJson('tareas_preventivo.json').map(r => ({ empresaId: r.empresaId || null, nombres: [r.tecnico] }));
}

(async () => {
  const empresas = await gestionDb.empresasListAll();
  const fuentesPorTemplate = {
    tigo: await climaRows(),
    wom: await womRows(),
    preventivo: await tareasRows()
  };

  let creadas = 0, yaExistian = 0, sinMatch = 0;

  for (const empresa of empresas) {
    const proyectos = await gestionDb.proyectosByEmpresa(empresa.id);
    const usuarios = (await gestionDb.usuariosList(empresa.id))
      .filter(u => u.activo && ['tecnico', 'supervisor'].includes(u.rol));
    if (!usuarios.length) continue;
    const usuariosPorNombre = new Map(usuarios.map(u => [norm(u.nombre), u]));

    for (const template of ['tigo', 'wom', 'preventivo']) {
      const proyecto = proyectos.find(p => p.template === template);
      if (!proyecto) continue;
      const filas = fuentesPorTemplate[template].filter(r => String(r.empresaId || '') === String(empresa.id));

      const nombresVistos = new Set();
      for (const fila of filas) {
        for (const nombre of fila.nombres) {
          const key = norm(nombre);
          if (!key || nombresVistos.has(key)) continue;
          nombresVistos.add(key);
          const usuario = usuariosPorNombre.get(key);
          if (!usuario) { sinMatch++; continue; }
          const existe = await gestionDb.asignacionExists(usuario.id, proyecto.id);
          if (existe) { yaExistian++; continue; }
          await gestionDb.asignacionUpsert(usuario.id, proyecto.id, usuario.rol === 'supervisor' ? 'supervisor' : 'tecnico');
          creadas++;
          console.log(`Asignado: ${usuario.nombre} (${usuario.rol}) -> ${proyecto.nombre} [${empresa.nombre}]`);
        }
      }
    }
  }

  console.log(`\nListo. Asignaciones creadas: ${creadas}. Ya existian: ${yaExistian}. Sin match de nombre: ${sinMatch}.`);
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
