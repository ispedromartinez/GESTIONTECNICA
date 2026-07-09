// scripts/migrar-modulos-caro.js
// Uso: node scripts/migrar-modulos-caro.js
// Crea las filas "módulo" (Tigo/WOM/Preventivo) para Ingenieria Caro y
// Caro, la única empresa que las tenía disponibles antes de este cambio.
require('dotenv').config();
const gestionDb = require('../db/gestion');

const NOMBRE_EMPRESA = 'INGENERIA CARO Y CARO LTDA';

const MODULOS = [
  { nombre: 'Proyecto Tigo', template: 'tigo' },
  { nombre: 'Proyecto WOM',  template: 'wom' },
  { nombre: 'Preventivo',    template: 'preventivo' }
];

(async () => {
  const empresas = await gestionDb.empresasListAll();
  const empresa = empresas.find(e => e.nombre === NOMBRE_EMPRESA);
  if (!empresa) {
    console.log(`Empresa "${NOMBRE_EMPRESA}" no encontrada — se omite la migración.`);
    process.exit(0);
  }

  const existentes = await gestionDb.proyectosByEmpresa(empresa.id);
  for (const m of MODULOS) {
    if (existentes.some(p => p.template === m.template)) {
      console.log(`Ya existe: ${m.nombre} (${m.template}) — se omite`);
      continue;
    }
    const creado = await gestionDb.proyectoInsert({
      empresa_id: empresa.id,
      nombre: m.nombre,
      template: m.template,
      estado: 'activo'
    });
    console.log(`Creado: ${creado.nombre} (${creado.template}) id=${creado.id}`);
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
