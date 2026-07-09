// scripts/migrar-modulos-caro.js
// Uso: node scripts/migrar-modulos-caro.js
// Crea las filas "módulo" (Tigo/WOM/Preventivo) para Ingenieria Caro y
// Caro, la única empresa que las tenía disponibles antes de este cambio.
require('dotenv').config();
const gestionDb = require('../db/gestion');

const NOMBRE_EMPRESA = 'INGENERIA CARO Y CARO LTDA'; // nombre real en la BD (con este typo)
// Normaliza para tolerar diferencias de mayúsculas/acentos/espacios entre
// ambientes (dev/staging/producción pueden tener el nombre tipeado distinto).
const normalizar = s => (s || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const MODULOS = [
  { nombre: 'Proyecto Tigo', template: 'tigo' },
  { nombre: 'Proyecto WOM',  template: 'wom' },
  { nombre: 'Preventivo',    template: 'preventivo' }
];

(async () => {
  const empresas = await gestionDb.empresasListAll();
  const objetivo = normalizar(NOMBRE_EMPRESA);
  const candidatas = empresas.filter(e => normalizar(e.nombre) === objetivo);
  if (candidatas.length === 0) {
    console.error(`ERROR: empresa "${NOMBRE_EMPRESA}" no encontrada (comparación normalizada, sin mayúsculas/acentos). Nombres disponibles: ${empresas.map(e => e.nombre).join(', ')}`);
    process.exit(1);
  }
  if (candidatas.length > 1) {
    console.error(`ERROR: ${candidatas.length} empresas coinciden con "${NOMBRE_EMPRESA}" — ambiguo, no se migra nada. IDs: ${candidatas.map(e => e.id).join(', ')}`);
    process.exit(1);
  }
  const empresa = candidatas[0];

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
