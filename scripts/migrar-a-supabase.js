// Migración one-shot: datos locales (auth.db + JSON + informes/) → Supabase.
// Requiere SUPABASE_URL/SUPABASE_KEY en .env. Idempotente por id/email:
// re-correr no duplica filas ya migradas.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'documentos-word';
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltan SUPABASE_URL / SUPABASE_KEY en .env');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const AUTH_DB_FILE = path.join(__dirname, '..', 'auth.db');
const REGISTRO_CLIMA = path.join(__dirname, '..', 'registro.json');
const REGISTRO_WOM   = path.join(__dirname, '..', 'registro_wom.json');
const TAREAS_PREV    = path.join(__dirname, '..', 'tareas_preventivo.json');
const DOCS_DIR_CLIMA = path.join(__dirname, '..', 'informes');
const DOCS_DIR_WOM   = path.join(__dirname, '..', 'informes_wom');

function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

async function upsert(table, rows, label) {
  if (!rows.length) { console.log(`${label}: 0 filas, nada que migrar`); return; }
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
  if (error) console.error(`${label}: ERROR ${error.message}`);
  else console.log(`${label}: ${rows.length} filas migradas`);
}

async function migrarAuth() {
  if (!fs.existsSync(AUTH_DB_FILE)) { console.log('auth.db: no existe, salto'); return; }
  const db = new Database(AUTH_DB_FILE, { readonly: true });

  const empresas = db.prepare('SELECT * FROM empresas').all().map(e => ({
    id: e.id, nombre: e.nombre, slug: e.slug, activa: !!e.activa,
    creado_en: e.creado_en, rut_empresa: e.rut_empresa,
    nombre_fantasia: e.nombre_fantasia, contacto: e.contacto,
    correo: e.correo, direccion: e.direccion
  }));
  await upsert('empresas', empresas, 'empresas');

  const areas = db.prepare('SELECT * FROM areas').all().map(a => ({
    id: a.id, empresa_id: a.empresa_id, nombre: a.nombre,
    activa: !!a.activa, creado_en: a.creado_en
  }));
  await upsert('areas', areas, 'areas');

  // Usuarios: si el email ya existe en Supabase (p.ej. el superadmin creado
  // vía /auth/register-superadmin), se conserva el de Supabase y se salta
  // el local para no violar el UNIQUE(email) ni pisar su password.
  const localUsuarios = db.prepare('SELECT * FROM usuarios').all();
  const { data: existentes } = await supabase.from('usuarios').select('email');
  const emailsExistentes = new Set((existentes || []).map(u => u.email));
  const usuarios = localUsuarios
    .filter(u => !emailsExistentes.has(u.email))
    .map(u => ({
      id: u.id, empresa_id: u.empresa_id, nombre: u.nombre, email: u.email,
      password_hash: u.password_hash, rol: u.rol, activo: !!u.activo,
      creado_en: u.creado_en, supervisor_id: u.supervisor_id
    }));
  const saltados = localUsuarios.length - usuarios.length;
  if (saltados) console.log(`usuarios: ${saltados} saltados (email ya existe en Supabase)`);
  await upsert('usuarios', usuarios, 'usuarios');

  const proyectos = db.prepare('SELECT * FROM proyectos').all().map(p => ({
    id: p.id, empresa_id: p.empresa_id, nombre: p.nombre, slug: p.slug,
    estado: p.estado, fecha_inicio: p.fecha_inicio, logo: p.logo,
    template: p.template, color: p.color, creado_en: p.creado_en,
    tipo: p.tipo, categoria: p.categoria, oculto: !!p.oculto
  }));
  await upsert('proyectos', proyectos, 'proyectos');

  const perfiles = db.prepare('SELECT * FROM perfiles').all().map(p => ({
    id: p.id, usuario_id: p.usuario_id, rut: p.rut, nombre: p.nombre,
    apellidos: p.apellidos, telefono: p.telefono, cargo: p.cargo,
    creado_en: p.creado_en
  }));
  await upsert('perfiles', perfiles, 'perfiles');

  db.close();
}

async function migrarInformesClima() {
  const rows = loadJson(REGISTRO_CLIMA).map(e => ({
    id: e.id, fecha: e.fecha, fecha_creacion: e.fechaCreacion,
    cod_informe: e.codInforme, nombre_sitio: e.nombreSitio,
    codigo_sitio: e.codigoSitio, tecnico: e.tecnico, supervisor: e.supervisor,
    num_ot: e.numOT, lpu: e.lpu || null, circuito: e.circuito || null,
    photo_count: e.photoCount, filename: e.filename,
    eq_numero: e.eqNumero || null, empresa_id: e.empresaId || null
  }));
  await upsert('informes_clima', rows, 'informes_clima');
}

async function migrarInformesWom() {
  const rows = loadJson(REGISTRO_WOM).map(e => ({
    id: e.id, fecha_creacion: e.fechaCreacion, ticket: e.ticket,
    cod_interno: e.codInterno, fecha_inicio: e.fechaInicio,
    instalacion: e.instalacion, tipo_actividad: e.tipoActividad,
    tecnicos: e.tecnicos, photo_count: e.photoCount, filename: e.filename,
    equipo: e.equipo || null, empresa_id: e.empresaId || null
  }));
  await upsert('informes_wom', rows, 'informes_wom');
}

async function migrarTareasPreventivo() {
  const rows = loadJson(TAREAS_PREV).map(t => ({ ...t }));
  await upsert('tareas_preventivo', rows, 'tareas_preventivo');
}

async function subirArchivos(dir, prefix, label) {
  if (!fs.existsSync(dir)) { console.log(`${label}: carpeta no existe, salto`); return; }
  const files = fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile());
  if (!files.length) { console.log(`${label}: 0 archivos, nada que subir`); return; }
  let ok = 0, fail = 0;
  for (const f of files) {
    const buffer = fs.readFileSync(path.join(dir, f));
    const { error } = await supabase.storage.from(BUCKET)
      .upload(`${prefix}/${f}`, buffer, { upsert: true });
    if (error) { fail++; console.error(`  ${f}: ${error.message}`); }
    else ok++;
  }
  console.log(`${label}: ${ok} subidos, ${fail} con error (de ${files.length})`);
}

(async () => {
  console.log('── Migrando auth.db (empresas/areas/usuarios/proyectos/perfiles) ──');
  await migrarAuth();
  console.log('── Migrando informes ──');
  await migrarInformesClima();
  await migrarInformesWom();
  await migrarTareasPreventivo();
  console.log('── Subiendo archivos al bucket ──');
  await subirArchivos(DOCS_DIR_CLIMA, 'clima', 'informes/ (clima)');
  await subirArchivos(DOCS_DIR_WOM, 'wom', 'informes_wom/ (wom)');
  console.log('Listo.');
})();
