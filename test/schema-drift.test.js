// Guardián de drift de esquema: schema/*.sql (Postgres/Supabase) es la fuente
// de verdad. Este test falla si db/local.js (SQLite) le falta alguna columna
// de las tablas relacionales compartidas — el drift que ya nos mordió.
//
// No traduce ni ejecuta DDL (eso sería frágil): compara por texto los nombres
// de columna de cada tabla en ambos lados.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Palabras que inician una restricción, no una columna.
const CONSTRAINT_KW = new Set(['unique','primary','check','foreign','constraint','create']);

// Extrae { tabla: Set(columnas) } de un texto SQL (CREATE TABLE + ALTER ADD COLUMN).
function parseSql(sql) {
  const tablas = {};
  // CREATE TABLE [IF NOT EXISTS] [public.]nombre ( ... );
  const reCreate = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["`]?(\w+)["`]?\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
  let m;
  while ((m = reCreate.exec(sql))) {
    const tabla = m[1].toLowerCase();
    const cols = tablas[tabla] || (tablas[tabla] = new Set());
    for (const linea of m[2].split('\n')) {
      const t = linea.trim();
      if (!t || t.startsWith('--')) continue;
      const primero = (t.match(/^["`]?(\w+)["`]?/) || [])[1];
      if (primero && !CONSTRAINT_KW.has(primero.toLowerCase())) cols.add(primero.toLowerCase());
    }
  }
  // ALTER TABLE [IF NOT EXISTS] nombre ADD COLUMN [IF NOT EXISTS] col
  const reAlter = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?["`]?(\w+)["`]?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?["`]?(\w+)["`]?/gi;
  while ((m = reAlter.exec(sql))) {
    const tabla = m[1].toLowerCase();
    (tablas[tabla] || (tablas[tabla] = new Set())).add(m[2].toLowerCase());
  }
  return tablas;
}

// Une todos los schema/*.sql (Postgres) en un solo mapa tabla→columnas.
function esquemaPostgres() {
  const merged = {};
  for (const f of fs.readdirSync(path.join(ROOT, 'schema')).filter(f => f.endsWith('.sql'))) {
    const parsed = parseSql(fs.readFileSync(path.join(ROOT, 'schema', f), 'utf8'));
    for (const [t, cols] of Object.entries(parsed)) {
      (merged[t] || (merged[t] = new Set()));
      cols.forEach(c => merged[t].add(c));
    }
  }
  return merged;
}

// Tablas relacionales que db/local.js SÍ implementa en SQLite (el resto de las
// tablas de Supabase —informes_clima/wom, sitios_catalogo, etc.— en local viven
// en archivos JSON, no en SQLite, así que no aplican a este guardián).
const TABLAS_LOCALES = [
  'empresas', 'usuarios', 'areas', 'usuario_areas',
  'perfiles', 'proyectos', 'asignaciones', 'informes', 'supervisor_tecnico'
];

test('db/local.js no tiene drift de columnas vs schema/*.sql', () => {
  const pg = esquemaPostgres();
  const local = parseSql(fs.readFileSync(path.join(ROOT, 'db', 'local.js'), 'utf8'));
  const faltantes = [];
  for (const tabla of TABLAS_LOCALES) {
    if (!pg[tabla]) continue; // la tabla no está en el schema Postgres → nada que comparar
    assert.ok(local[tabla], `db/local.js no define la tabla '${tabla}' que sí está en schema/*.sql`);
    for (const col of pg[tabla]) {
      if (!local[tabla].has(col)) faltantes.push(`${tabla}.${col}`);
    }
  }
  assert.deepEqual(faltantes, [],
    `db/local.js le faltan columnas que schema/*.sql sí define: ${faltantes.join(', ')}. ` +
    `Agregá el ALTER TABLE correspondiente en db/local.js.`);
});
