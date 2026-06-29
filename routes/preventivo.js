// ════════════════════════════════════════════════════════════════
// Módulo: Mantenimiento Preventivo (gestión de tareas)
// Portado desde el proyecto "programa preventivo".
// Almacenamiento: Supabase (tabla 'tareas_preventivo') con fallback
// a archivo local 'tareas_preventivo.json'. Protegido con authMiddleware.
// ════════════════════════════════════════════════════════════════
const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSXStyle = require('xlsx-js-style');
const { authMiddleware } = require('../middleware/auth');
const { requireNivel } = require('../middleware/roles');
const { canAccessTenant, scopeToTenant } = require('../middleware/tenant');
const localDB = require('../db/local');
const { supabase } = require('../db/supabase');

const TABLE = 'tareas_preventivo';
const TAREAS_FILE = path.join(__dirname, '..', 'tareas_preventivo.json');
if (!fs.existsSync(TAREAS_FILE)) fs.writeFileSync(TAREAS_FILE, '[]');

// ── Mapeo camelCase (app) ↔ snake_case (Supabase) ───────────────
const fromTarea = r => ({
  id: r.id, descripcion: r.descripcion, tecnico: r.tecnico,
  fechaInicio: r.fecha_inicio, fechaVencimiento: r.fecha_vencimiento,
  estado: r.estado, sitio: r.sitio, destacada: r.destacada,
  tareaNumero: r.tarea_numero, categoria: r.categoria,
  nombreCliente: r.nombre_cliente, sala: r.sala, nombreEmpleado: r.nombre_empleado,
  crqInc: r.crq_inc, numeroEmpleado: r.numero_empleado, numeroCliente: r.numero_cliente,
  nWorkflow: r.n_workflow, nLpu: r.n_lpu,
  comuna: r.comuna, recurrencia: r.recurrencia, notas: r.notas,
  semanaIso: r.semana_iso, fechaCreacion: r.fecha_creacion,
  estadoCambiadoEn: r.estado_cambiado_en || r.fecha_creacion || null,
  criticidad: r.criticidad, categoriaSitio: r.categoria_sitio,
  direccion: r.direccion, ciudad: r.ciudad, idAcceso: r.id_acceso,
  empresaId: r.empresa_id || null,
  equipos: r.equipos || []
});
const toTarea = e => ({
  id: e.id, descripcion: e.descripcion, tecnico: e.tecnico,
  fecha_inicio: e.fechaInicio, fecha_vencimiento: e.fechaVencimiento,
  estado: e.estado, sitio: e.sitio, destacada: e.destacada,
  tarea_numero: e.tareaNumero, categoria: e.categoria,
  nombre_cliente: e.nombreCliente, sala: e.sala, nombre_empleado: e.nombreEmpleado,
  crq_inc: e.crqInc, numero_empleado: e.numeroEmpleado, numero_cliente: e.numeroCliente,
  n_workflow: e.nWorkflow, n_lpu: e.nLpu,
  comuna: e.comuna, recurrencia: e.recurrencia, notas: e.notas,
  semana_iso: e.semanaIso, fecha_creacion: e.fechaCreacion,
  estado_cambiado_en: e.estadoCambiadoEn || null,
  criticidad: e.criticidad, categoria_sitio: e.categoriaSitio,
  direccion: e.direccion, ciudad: e.ciudad, id_acceso: e.idAcceso,
  empresa_id: e.empresaId || null,
  equipos: e.equipos || []
});

// ── Repositorio (Supabase + fallback local) ─────────────────────
const loadDB = () => { try { return JSON.parse(fs.readFileSync(TAREAS_FILE, 'utf8')); } catch { return []; } };
const saveDB = d  => fs.writeFileSync(TAREAS_FILE, JSON.stringify(d, null, 2));

async function dbTareasList() {
  if (supabase) {
    const { data, error } = await supabase.from(TABLE).select('*').order('fecha_creacion', { ascending: false });
    if (!error) return (data || []).map(fromTarea);
    console.error('tareas list:', error.message);
  }
  return loadDB();
}
async function dbTareasInsert(entry) {
  if (supabase) {
    const { error } = await supabase.from(TABLE).insert(toTarea(entry));
    if (error) console.error('tareas insert:', error.message);
  } else { const db = loadDB(); db.unshift(entry); saveDB(db); }
}
async function dbTareasInsertMany(entries) {
  if (!entries || !entries.length) return;
  if (supabase) {
    const { error } = await supabase.from(TABLE).insert(entries.map(toTarea));
    if (error) console.error('tareas insertMany:', error.message);
  } else { const db = loadDB(); for (const e of entries) db.unshift(e); saveDB(db); }
}
async function dbTareasFind(id) {
  if (supabase) {
    const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).single();
    if (!error && data) return fromTarea(data);
  }
  return loadDB().find(r => r.id === id) || null;
}
async function dbTareasUpdate(id, patch) {
  if (supabase) {
    const { error } = await supabase.from(TABLE).update(toTarea(patch)).eq('id', id);
    if (error) { console.error('tareas update:', error.message); return { error: error.message }; }
  } else {
    const db = loadDB();
    const idx = db.findIndex(r => r.id === id);
    if (idx === -1) return { error: 'id no encontrado' };
    db[idx] = { ...db[idx], ...patch };
    saveDB(db);
  }
  return { ok: true };
}
async function dbTareasDelete(id) {
  if (supabase) {
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) { console.error('tareas delete:', error.message); return { error: error.message }; }
  } else { saveDB(loadDB().filter(r => r.id !== id)); }
  return { ok: true };
}

// ── Helpers de semana ───────────────────────────────────────────
function enRangoSemana(fechaInicioISO, semanaISO) {
  if (!semanaISO) return true;
  const lunes = new Date(semanaISO + 'T00:00:00');
  const domingo = new Date(lunes); domingo.setDate(domingo.getDate() + 6);
  const f = new Date(fechaInicioISO + 'T00:00:00');
  return f >= lunes && f <= domingo;
}
// Semana ISO 8601 (lunes-domingo, semana que contiene el primer jueves del año)
function semanaIsoDeFecha(fechaStr) {
  if (!fechaStr) return '';
  const d = new Date(fechaStr + 'T00:00:00');
  const diaIso = (d.getDay() + 6) % 7;
  const jueves = new Date(d);
  jueves.setDate(d.getDate() - diaIso + 3);
  const primerJueves = new Date(jueves.getFullYear(), 0, 4);
  const diaIsoPrimerJueves = (primerJueves.getDay() + 6) % 7;
  primerJueves.setDate(primerJueves.getDate() - diaIsoPrimerJueves + 3);
  const semana = 1 + Math.round((jueves - primerJueves) / (7 * 24 * 60 * 60 * 1000));
  return `${jueves.getFullYear()}-W${String(semana).padStart(2, '0')}`;
}

// ── Recurrencia: genera tareas repetidas a 12 meses ─────────────
// Meses entre ocurrencias por frecuencia. La cantidad en 12 meses
// es 12/intervalo: Anual=1, Semestral=2, Cuatrimestral=3,
// Trimestral=4, Bimestral=6, Mensual=12.
const RECURRENCIA_INTERVALOS = {
  Anual: 12, Semestral: 6, Cuatrimestral: 4, Trimestral: 3, Bimestral: 2, Mensual: 1
};
function addMonths(iso, n) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < day) d.setDate(0); // si el mes destino es más corto, fin de mes
  return d.toISOString().slice(0, 10);
}
function addDays(iso, n) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function diasEntre(aIso, bIso) {
  if (!aIso || !bIso) return 0;
  return Math.round((new Date(bIso + 'T00:00:00') - new Date(aIso + 'T00:00:00')) / 86400000);
}
// Devuelve la serie de tareas (incluida la primera) según la recurrencia.
// Si no es recurrente o falta fecha de inicio, devuelve solo la tarea base.
function expandirRecurrencia(base) {
  const intervalo = RECURRENCIA_INTERVALOS[base.recurrencia];
  if (!intervalo || !base.fechaInicio) return [base];
  const dur = diasEntre(base.fechaInicio, base.fechaVencimiento);
  const serie = [];
  for (let m = 0, i = 0; m < 12; m += intervalo, i++) {
    const ini = addMonths(base.fechaInicio, m);
    serie.push({
      ...base,
      id: (Date.now() + i).toString(),
      fechaInicio: ini,
      fechaVencimiento: base.fechaVencimiento ? addDays(ini, dur) : '',
      semanaIso: semanaIsoDeFecha(ini),
      fechaCreacion: new Date().toISOString()
    });
  }
  return serie;
}

// ── Export a Excel con estilo ───────────────────────────────────
const XL_AZUL  = 'FF0073EA';   // cabecera
const XL_ZEBRA = 'FFEAF3FF';   // filas pares
const XL_BORDE = 'FFB9C4DE';   // líneas de la tabla
function buildReporteExcel(colMap, validColumns, rows, sheetName = 'Tareas') {
  const headerRow = validColumns.map(c => colMap[c]);
  const dataRows = rows.map(r => validColumns.map(c => String(r[c] ?? '')));
  const ws = XLSXStyle.utils.aoa_to_sheet([headerRow, ...dataRows]);
  const thin = { style: 'thin', color: { rgb: XL_BORDE } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const ncols = validColumns.length;
  for (let R = 0; R <= dataRows.length; R++) {
    for (let C = 0; C < ncols; C++) {
      const ref = XLSXStyle.utils.encode_cell({ r: R, c: C });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      if (R === 0) {
        ws[ref].s = {
          font: { bold: true, sz: 11, color: { rgb: 'FFFFFFFF' }, name: 'Calibri' },
          fill: { patternType: 'solid', fgColor: { rgb: XL_AZUL } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border
        };
      } else {
        ws[ref].s = {
          font: { sz: 10, color: { rgb: 'FF323338' }, name: 'Calibri' },
          fill: { patternType: 'solid', fgColor: { rgb: R % 2 === 0 ? XL_ZEBRA : 'FFFFFFFF' } },
          alignment: { horizontal: 'left', vertical: 'center', wrapText: false },
          border
        };
      }
    }
  }
  ws['!cols'] = validColumns.map((c, i) => {
    const lens = [colMap[c].length, ...dataRows.map(row => (row[i] || '').length)];
    return { wch: Math.min(Math.max(Math.max(...lens) + 2, 12), 45) };
  });
  ws['!rows'] = [{ hpt: 22 }];
  const lastCol = XLSXStyle.utils.encode_col(ncols - 1);
  ws['!autofilter'] = { ref: `A1:${lastCol}${dataRows.length + 1}` };
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, sheetName);
  return XLSXStyle.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Etiquetas idénticas a la planilla real de carga masiva (Officetrack)
const TAREAS_COLUMNAS = {
  nombreCliente: 'Nombre del Cliente', sala: 'SALA',
  nombreEmpleado: 'Nombre del empleado', crqInc: 'N°CRQ/INC',
  descripcion: 'Descripción', numeroEmpleado: 'Número del empleado',
  fechaInicio: 'Fecha de inicio', fechaVencimiento: 'Fecha de vencimiento',
  categoria: 'Categoría de tarea', numeroCliente: 'Número del cliente',
  nWorkflow: 'N° Workflow', nLpu: 'N°LPU', comuna: 'Comuna',
  tareaNumero: 'Tarea Número', tecnico: 'Técnico', sitio: 'Sitio',
  estado: 'Estado', semanaIso: 'Semana ISO', recurrencia: 'Recurrencia', notas: 'Notas'
};
const TAREAS_COLUMNAS_INV = Object.fromEntries(Object.entries(TAREAS_COLUMNAS).map(([k, v]) => [v, k]));

// ════════════════════════════════════════════════════════════════
// RUTAS — todas protegidas con login (JWT)
// ════════════════════════════════════════════════════════════════
const router = express.Router();
router.use(authMiddleware);

// ── Scope por tenant (delegado en middleware/tenant.js) ─────────
// superadmin ve todo; el resto solo las tareas de su propio tenant.
// Las tareas sin tenant (legado) solo las ve superadmin.
function filtraEmpresa(rows, user) {
  return scopeToTenant({ user }, rows, r => r.empresaId);
}
function puedeTocar(tarea, user) {
  return canAccessTenant({ user }, tarea && tarea.empresaId);
}
// Nombres (en minúscula) de los técnicos activos de una empresa — para validar asignaciones.
async function tecnicosDeEmpresa(empresaId) {
  let users = [];
  if (supabase) {
    let q = supabase.from('usuarios').select('nombre,rol,activo,empresa_id');
    if (empresaId) q = q.eq('empresa_id', empresaId);
    const { data } = await q;
    users = data || [];
  } else {
    users = localDB.usuarios.list(empresaId);
  }
  return users
    .filter(u => u.rol === 'tecnico' && u.activo)
    .map(u => (u.nombre || '').trim().toLowerCase());
}

router.get('/', async (req, res) => {
  try {
    const { semana, tecnico, desde, hasta } = req.query;
    let rows = filtraEmpresa(await dbTareasList(), req.user);
    // Un técnico solo ve las tareas asignadas a su propio nombre.
    if (req.user.rol === 'tecnico') {
      const yo = (req.user.nombre || '').trim().toLowerCase();
      rows = rows.filter(r => (r.tecnico || '').trim().toLowerCase() === yo);
    }
    if (semana) rows = rows.filter(r => enRangoSemana(r.fechaInicio, semana));
    if (desde) rows = rows.filter(r => r.fechaInicio && r.fechaInicio >= desde);
    if (hasta) rows = rows.filter(r => r.fechaInicio && r.fechaInicio <= hasta);
    if (tecnico && tecnico !== 'Todos') rows = rows.filter(r => r.tecnico === tecnico);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.post('/', requireNivel(2), async (req, res) => {
  try {
    const d = req.body;
    // El técnico asignado debe ser un técnico activo de la empresa (superadmin exento).
    if (req.user.rol !== 'superadmin') {
      const tec = (d.tecnico || '').trim().toLowerCase();
      const validos = await tecnicosDeEmpresa(req.user.empresa_id);
      if (!tec || !validos.includes(tec)) {
        return res.status(400).json({ error: 'Debes asignar la tarea a un técnico de tu empresa.' });
      }
    }
    const entry = {
      id: Date.now().toString(),
      descripcion: d.descripcion || '', tecnico: d.tecnico || '',
      fechaInicio: d.fechaInicio || '', fechaVencimiento: d.fechaVencimiento || '',
      estado: d.estado || 'Nuevo', sitio: d.sitio || '',
      tareaNumero: d.tareaNumero || '', categoria: d.categoria || 'CLMAPREV',
      nombreCliente: d.nombreCliente || '', sala: d.sala || '', nombreEmpleado: d.nombreEmpleado || '',
      crqInc: d.crqInc || '', numeroEmpleado: d.numeroEmpleado || '', numeroCliente: d.numeroCliente || '',
      nWorkflow: d.nWorkflow || '', nLpu: d.nLpu || '',
      comuna: d.comuna || '', recurrencia: d.recurrencia || 'Única vez', notas: d.notas || '',
      semanaIso: d.semanaIso || '',
      criticidad: d.criticidad || '', categoriaSitio: d.categoriaSitio || '',
      direccion: d.direccion || '', ciudad: d.ciudad || '', idAcceso: d.idAcceso || '',
      equipos: Array.isArray(d.equipos) ? d.equipos : [],
      empresaId: req.user.empresa_id || null,
      destacada: false, fechaCreacion: new Date().toISOString()
    };
    // Recurrencia: si aplica, genera la serie de tareas repetidas (12 meses).
    const serie = expandirRecurrencia(entry);
    if (serie.length > 1) {
      await dbTareasInsertMany(serie);
      return res.json({ ...serie[0], generadas: serie.length });
    }
    await dbTareasInsert(entry);
    res.json(entry);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireNivel(2), async (req, res) => {
  try {
    const tarea = await dbTareasFind(req.params.id);
    if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
    if (!puedeTocar(tarea, req.user)) return res.status(403).json({ error: 'Sin acceso a esta tarea' });
    const patch = { ...req.body };
    delete patch.empresaId; // la empresa no se reasigna vía edición
    if (patch.estado && patch.estado !== tarea.estado) {
      patch.estadoCambiadoEn = new Date().toISOString();
    }
    const result = await dbTareasUpdate(req.params.id, patch);
    if (result && result.error) return res.status(500).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.delete('/:id', requireNivel(2), async (req, res) => {
  try {
    const tarea = await dbTareasFind(req.params.id);
    if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
    if (!puedeTocar(tarea, req.user)) return res.status(403).json({ error: 'Sin acceso a esta tarea' });
    const result = await dbTareasDelete(req.params.id);
    if (result && result.error) return res.status(500).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.post('/:id/destacar', async (req, res) => {
  try {
    const tarea = await dbTareasFind(req.params.id);
    if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
    if (!puedeTocar(tarea, req.user)) return res.status(403).json({ error: 'Sin acceso a esta tarea' });
    const result = await dbTareasUpdate(req.params.id, { destacada: !tarea.destacada });
    if (result && result.error) return res.status(500).json({ error: result.error });
    res.json({ ok: true, destacada: !tarea.destacada });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.get('/backup', async (req, res) => {
  try {
    const rows = filtraEmpresa(await dbTareasList(), req.user);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="tareas-backup.json"');
    res.send(JSON.stringify(rows, null, 2));
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.get('/exportar', async (req, res) => {
  try {
    const { semana, tecnico, desde, hasta } = req.query;
    let rows = filtraEmpresa(await dbTareasList(), req.user);
    if (semana) rows = rows.filter(r => enRangoSemana(r.fechaInicio, semana));
    if (desde) rows = rows.filter(r => r.fechaInicio && r.fechaInicio >= desde);
    if (hasta) rows = rows.filter(r => r.fechaInicio && r.fechaInicio <= hasta);
    if (tecnico && tecnico !== 'Todos') rows = rows.filter(r => r.tecnico === tecnico);
    const buffer = buildReporteExcel(TAREAS_COLUMNAS, Object.keys(TAREAS_COLUMNAS), rows, 'Tareas');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="tareas-preventivo.xlsx"');
    res.send(buffer);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.get('/plantilla', (req, res) => {
  try {
    const buffer = buildReporteExcel(TAREAS_COLUMNAS, Object.keys(TAREAS_COLUMNAS), [], 'Tareas');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-tareas-preventivo.xlsx"');
    res.send(buffer);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.get('/informes-map', (req, res) => {
  try {
    const file = path.join(__dirname, '..', 'tareas_informes.json');
    const mapa = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    res.json(mapa);
  } catch { res.json({}); }
});

// Va después de las rutas literales /backup, /exportar, /plantilla
// para que ":id" no las intercepte.
router.get('/:id', async (req, res) => {
  try {
    const tarea = await dbTareasFind(req.params.id);
    if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
    if (!puedeTocar(tarea, req.user)) return res.status(403).json({ error: 'Sin acceso a esta tarea' });
    res.json(tarea);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.post('/importar', requireNivel(2), async (req, res) => {
  try {
    const { dataBase64, primeraFilaEncabezados } = req.body;
    if (!dataBase64) return res.status(400).json({ error: 'Falta el archivo' });
    const buf = Buffer.from(dataBase64, 'base64');
    const wb = XLSXStyle.read(buf, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const opts = { defval: '', cellDates: true };
    if (primeraFilaEncabezados === false) opts.header = Object.values(TAREAS_COLUMNAS);
    const filas = XLSXStyle.utils.sheet_to_json(sheet, opts);
    let primeraFechaInicio = '';
    const nuevas = [];
    for (let i = 0; i < filas.length; i++) {
      // Encabezados con espacios extra (ej. "SALA ") no deben romper el match
      const fila = Object.fromEntries(Object.entries(filas[i]).map(([k, v]) => [k.trim(), v]));
      const entry = { id: (Date.now() + i).toString(), destacada: false, fechaCreacion: new Date().toISOString() };
      for (const [label, key] of Object.entries(TAREAS_COLUMNAS_INV)) {
        const valor = fila[label];
        entry[key] = valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor ?? '').trim();
      }
      // Nombre del sitio: el encabezado varía según la planilla.
      // En la carga masiva Officetrack la columna se llama "SITIOS" (plural);
      // en otras puede ser "Sitio", "Cliente", "Nombre Nodo / Hub / SW", etc.
      const nombreSitio = [
        fila['SITIOS'], fila['Sitios'], fila['SITIO'], fila['Sitio'], fila['Cliente'],
        fila['Nombre Nodo / Hub / SW'], fila['Nombre Nodo'], fila['Hub']
      ].map(v => String(v ?? '').trim()).find(Boolean) || '';
      if (!entry.sitio)         entry.sitio = nombreSitio || entry.nombreCliente || '';
      if (!entry.nombreCliente) entry.nombreCliente = nombreSitio || entry.sitio || '';
      if (!entry.tecnico) entry.tecnico = String(fila['Técnico asignado'] ?? fila['Nombre del Técnico'] ?? fila['Tecnico'] ?? fila['Técnico asignado al sitio'] ?? '').trim();
      if (!entry.crqInc) entry.crqInc = String(fila['N° CRQ/INC'] ?? fila['CRQ/INC'] ?? fila['CRQ'] ?? fila['N° CRQ'] ?? fila['Nro CRQ'] ?? fila['Número CRQ'] ?? fila['N°CRQ'] ?? '').trim();
      entry.estado = entry.estado || 'Nuevo';
      entry.categoria = entry.categoria || 'CLMAPREV';
      entry.recurrencia = entry.recurrencia || 'Única vez';
      entry.semanaIso = entry.semanaIso || semanaIsoDeFecha(entry.fechaInicio);
      entry.tecnico = entry.tecnico || entry.nombreEmpleado;
      entry.empresaId = req.user.empresa_id || null;
      nuevas.push(entry);
      if (!primeraFechaInicio && entry.fechaInicio) primeraFechaInicio = entry.fechaInicio;
    }
    // Inserción en una sola pasada (rápida; no bloquea el servidor)
    await dbTareasInsertMany(nuevas);
    res.json({ ok: true, importadas: nuevas.length, primeraFechaInicio });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

module.exports = router;
