// scripts/seed-areas-default.js
// Uso: node scripts/seed-areas-default.js
// Crea las 3 áreas por defecto (Clima/Energía/Obras Civiles-OOCC) para
// todas las empresas existentes que aún no las tengan. Idempotente.
require('dotenv').config();
const gestionDb = require('../db/gestion');

const AREAS_DEFAULT = ['Clima', 'Energía', 'Obras Civiles (OOCC)'];

(async () => {
  const empresas = await gestionDb.empresasListAll();
  for (const empresa of empresas) {
    const existentes = await gestionDb.areasByEmpresa(empresa.id);
    for (const nombre of AREAS_DEFAULT) {
      if (existentes.some(a => a.nombre === nombre)) {
        console.log(`${empresa.nombre}: ya existe "${nombre}" — se omite`);
        continue;
      }
      const creada = await gestionDb.areaInsert({ empresa_id: empresa.id, nombre });
      console.log(`${empresa.nombre}: creada "${creada.nombre}" id=${creada.id}`);
    }
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
