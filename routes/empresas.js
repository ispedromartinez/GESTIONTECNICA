const express = require('express');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx-js-style');
const { authMiddleware } = require('../middleware/auth');
const { requireRol } = require('../middleware/roles');
const { validarRut, normalizarRut } = require('../utils/rut');
const db = require('../db/gestion');

const router = express.Router();
router.use(authMiddleware);

// superadmin: gestiona todas las empresas (plataforma).
// admin_empresa: solo SU empresa (el cliente).
const adminEmpresa = requireRol('superadmin', 'admin_empresa');
const soloSuper = requireRol('superadmin');

// Límite de seguridad: admin_empresa solo accede a su propia empresa.
function scopeEmpresa(req, res, next) {
  if (req.user.rol === 'superadmin') return next();
  if (req.params.id !== req.user.empresa_id)
    return res.status(403).json({ error: 'Solo puedes acceder a tu propia empresa' });
  next();
}

const ROLES_VALIDOS = ['superadmin','admin_empresa','supervisor','tecnico'];

// ════════════════════════════════════════════════════════════════
// EMPRESAS
// ════════════════════════════════════════════════════════════════

// GET /api/empresas — listado con conteos
// superadmin: todas · admin_empresa: solo la suya
router.get('/empresas', adminEmpresa, async (req, res) => {
  try {
    const empresas = req.user.rol === 'superadmin'
      ? await db.empresasListAll()
      : [await db.empresaById(req.user.empresa_id)].filter(Boolean);
    const usuarios = await db.usuariosList(req.user.rol === 'superadmin' ? null : req.user.empresa_id);
    const proyectos = req.user.rol === 'superadmin'
      ? await db.proyectosAll()
      : await db.proyectosByEmpresa(req.user.empresa_id);
    const data = empresas.map(e => ({
      id: e.id, nombre: e.nombre, slug: e.slug,
      rut_empresa: e.rut_empresa || null,
      activa: !!e.activa,
      total_usuarios: usuarios.filter(u => u.empresa_id === e.id).length,
      total_proyectos: proyectos.filter(p => p.empresa_id === e.id).length,
      creado_en: e.creado_en
    }));
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/empresas — nueva empresa (solo superadmin: crear clientes)
router.post('/empresas', soloSuper, async (req, res) => {
  try {
    let { nombre, slug, rut_empresa } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    // El RUT es el identificador único de la empresa: obligatorio.
    if (!rut_empresa) return res.status(400).json({ error: 'El RUT de empresa es obligatorio (identificador único)' });
    slug = (slug || nombre).toLowerCase().trim()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) return res.status(400).json({ error: 'slug inválido' });

    if (!validarRut(rut_empresa))
      return res.status(400).json({ error: 'RUT de empresa inválido (dígito verificador)' });
    const rutNorm = normalizarRut(rut_empresa);
    const existe = (await db.empresasListAll()).find(e => e.rut_empresa === rutNorm);
    if (existe) return res.status(409).json({ error: 'Ya existe una empresa con ese RUT' });
    const dupSlug = (await db.empresasListAll()).find(e => e.slug === slug);
    if (dupSlug) return res.status(409).json({ error: 'Ya existe una empresa con ese identificador' });

    const empresa = await db.empresaInsert({ nombre, slug, rut_empresa: rutNorm });
    res.json({ ok: true, empresa });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/empresas/:id — detalle
router.get('/empresas/:id', adminEmpresa, scopeEmpresa, async (req, res) => {
  try {
    const empresa = await db.empresaById(req.params.id);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    res.json(empresa);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/empresas/:id — editar (activar/desactivar y slug solo superadmin)
router.put('/empresas/:id', adminEmpresa, scopeEmpresa, async (req, res) => {
  try {
    const empresa = await db.empresaById(req.params.id);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const esSuper = req.user.rol === 'superadmin';
    const { nombre, slug, rut_empresa, activa } = req.body;
    const fields = {};
    if (nombre !== undefined) fields.nombre = nombre.trim();
    // slug y estado (activa) son potestad de la plataforma (superadmin)
    if (slug !== undefined && esSuper) fields.slug = slug.toLowerCase().trim();
    if (activa !== undefined && esSuper) fields.activa = activa ? 1 : 0;
    if (rut_empresa !== undefined) {
      // El RUT es el identificador único: no puede quedar vacío.
      if (!rut_empresa) return res.status(400).json({ error: 'El RUT de empresa no puede quedar vacío' });
      if (!validarRut(rut_empresa))
        return res.status(400).json({ error: 'RUT de empresa inválido' });
      const rutNorm = normalizarRut(rut_empresa);
      const otra = (await db.empresasListAll()).find(e => e.rut_empresa === rutNorm && e.id !== req.params.id);
      if (otra) return res.status(409).json({ error: 'Ese RUT ya pertenece a otra empresa' });
      fields.rut_empresa = rutNorm;
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nada para actualizar' });
    const actualizada = await db.empresaUpdate(req.params.id, fields);
    res.json({ ok: true, empresa: actualizada });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/empresas/:id/usuarios
router.get('/empresas/:id/usuarios', adminEmpresa, scopeEmpresa, async (req, res) => {
  try {
    res.json(await db.usuariosList(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/empresas/:id/proyectos — del modelo relacional (tabla proyectos)
router.get('/empresas/:id/proyectos', adminEmpresa, scopeEmpresa, async (req, res) => {
  try {
    const list = await db.proyectosByEmpresa(req.params.id);
    res.json(list.map(p => ({
      id: p.id, slug: p.slug, nombre: p.nombre, template: p.template,
      color: p.color, estado: p.estado, fecha_inicio: p.fecha_inicio,
      creado_en: p.creado_en
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════
// USUARIOS
// ════════════════════════════════════════════════════════════════

// POST /api/usuarios — crear usuario (campos de la tabla + perfil + área)
router.post('/usuarios', adminEmpresa, async (req, res) => {
  try {
    const { nombre, email, password, rut, cargo, area_id } = req.body;
    let { rol, empresa_id } = req.body;
    if (!nombre || !email || !password || !rol)
      return res.status(400).json({ error: 'nombre, email, password y rol requeridos' });
    if (!ROLES_VALIDOS.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener 6+ caracteres' });

    // admin_empresa: solo crea en SU empresa y solo supervisor/técnico
    if (req.user.rol === 'admin_empresa') {
      empresa_id = req.user.empresa_id;
      if (!['supervisor','tecnico'].includes(rol))
        return res.status(403).json({ error: 'Solo puedes crear supervisores y técnicos' });
    }
    if (rol !== 'superadmin' && !empresa_id)
      return res.status(400).json({ error: 'empresa_id requerido para este rol' });

    // RUT (opcional): valida dígito verificador y unicidad ANTES de crear (evita usuario huérfano)
    let rutNorm = null;
    if (rut) {
      if (!validarRut(rut))
        return res.status(400).json({ error: 'RUT inválido (dígito verificador incorrecto)' });
      rutNorm = normalizarRut(rut);
      if (await db.perfilByRut(rutNorm))
        return res.status(409).json({ error: 'Ese RUT ya está registrado' });
    }

    // Área (opcional): debe pertenecer a la empresa del usuario
    if (area_id) {
      const area = await db.areaById(area_id);
      if (!area || area.empresa_id !== empresa_id)
        return res.status(400).json({ error: 'El área no pertenece a esta empresa' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const usuario = await db.usuarioInsert({
      nombre, email: email.toLowerCase().trim(), password_hash, rol,
      empresa_id: rol === 'superadmin' ? null : empresa_id, activo: true
    });

    // Perfil (RUT / cargo) y asignación de área, ya con el id del usuario
    if (rutNorm || cargo)
      await db.perfilUpsert({ usuario_id: usuario.id, rut: rutNorm, nombre, cargo: cargo || null });
    if (area_id)
      await db.usuarioAreaUpsert(usuario.id, area_id, req.user.usuario_id);

    res.json({ ok: true, usuario });
  } catch (err) {
    const msg = /unique|duplicate/i.test(err.message) ? 'Ese correo ya está en uso' : err.message;
    res.status(400).json({ error: msg });
  }
});

// ════════════════════════════════════════════════════════════════
// CARGA MASIVA DE USUARIOS (supervisor y admin_empresa)
// ════════════════════════════════════════════════════════════════

// La carga masiva la pueden hacer supervisor, admin_empresa y superadmin.
const puedeImportarUsuarios = requireRol('superadmin', 'admin_empresa', 'supervisor');

// Columnas de la plantilla, en orden.
const USUARIOS_COLS = ['Nombre', 'Apellido', 'RUT', 'Email', 'Empresa', 'RUT Empresa', 'Cargo', 'Supervisor', 'RUT Supervisor', 'Proyecto'];

// GET /api/usuarios/plantilla — descarga la plantilla .xlsx
router.get('/usuarios/plantilla', puedeImportarUsuarios, (req, res) => {
  try {
    const ejemplo = ['Juan', 'Pérez', '12.345.678-5', 'juan.perez@icetel.cl', 'ICETEL', '77.466.910-8', 'Técnico de terreno', 'Pedro Soto', '11.111.111-1', 'Proyecto TIGO'];
    const ws = XLSX.utils.aoa_to_sheet([USUARIOS_COLS, ejemplo]);
    ws['!cols'] = USUARIOS_COLS.map(() => ({ wch: 20 }));
    // Encabezados en negrita
    USUARIOS_COLS.forEach((_, c) => {
      const ref = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[ref]) ws[ref].s = { font: { bold: true }, fill: { fgColor: { rgb: 'E6E9EF' } } };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Usuarios');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-usuarios.xlsx"');
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/usuarios/importar — crea usuarios en lote desde un .xlsx (base64)
router.post('/usuarios/importar', puedeImportarUsuarios, async (req, res) => {
  try {
    const { dataBase64 } = req.body;
    if (!dataBase64) return res.status(400).json({ error: 'Falta el archivo' });
    const buf = Buffer.from(dataBase64, 'base64');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const filasRaw = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const creador = req.user;
    const esSuper = creador.rol === 'superadmin';

    // Empresa por defecto (admin/supervisor): la propia
    const empresaDefault = esSuper ? null : await db.empresaById(creador.empresa_id);
    const todasEmp = esSuper ? await db.empresasListAll() : [empresaDefault].filter(Boolean);

    // Normaliza cada fila a un objeto de campos + nº de fila Excel (1 = encabezado)
    const filas = filasRaw.map((r, i) => {
      const f = Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim(), String(v ?? '').trim()]));
      return {
        fila: i + 2,
        nombre: f['Nombre'] || '', apellido: f['Apellido'] || '', rut: f['RUT'] || '',
        email: (f['Email'] || '').toLowerCase(), empresaNom: f['Empresa'] || '', rutEmpresa: f['RUT Empresa'] || '',
        cargo: f['Cargo'] || '', supNom: f['Supervisor'] || '', rutSup: f['RUT Supervisor'] || '',
        proyectoNom: f['Proyecto'] || '',
        rol: /supervisor/i.test(f['Cargo'] || '') ? 'supervisor' : 'tecnico'
      };
    }).filter(r => r.nombre || r.apellido || r.rut || r.email);

    // Procesa supervisores primero para que los técnicos puedan referenciarlos en el mismo lote
    filas.sort((a, b) => (a.rol === 'supervisor' ? 0 : 1) - (b.rol === 'supervisor' ? 0 : 1));

    const creados = [], errores = [];
    const supRutMap = {}; // rutNorm del supervisor → usuario_id
    const proyCache = {}; // empresa_id → [proyectos] (para resolver la columna "Proyecto")
    const proyectosDe = async (empId) => {
      if (!proyCache[empId]) proyCache[empId] = await db.proyectosByEmpresa(empId);
      return proyCache[empId];
    };

    for (const row of filas) {
      const nombreCompleto = [row.nombre, row.apellido].filter(Boolean).join(' ').trim();
      try {
        if (!nombreCompleto) throw new Error('Falta nombre y apellido');

        // Empresa
        let empresa;
        if (esSuper) {
          const rutE = row.rutEmpresa ? normalizarRut(row.rutEmpresa) : null;
          empresa = (rutE && todasEmp.find(e => e.rut_empresa === rutE))
                 || (row.empresaNom && todasEmp.find(e => (e.nombre || '').toLowerCase() === row.empresaNom.toLowerCase()));
          if (!empresa) throw new Error('Empresa no encontrada (revisa "RUT Empresa")');
        } else {
          empresa = empresaDefault;
          if (row.rutEmpresa && empresa.rut_empresa && normalizarRut(row.rutEmpresa) !== empresa.rut_empresa)
            throw new Error('El RUT de empresa no coincide con tu empresa');
        }

        // Rol (según cargo) y permiso del creador
        if (creador.rol === 'supervisor' && row.rol !== 'tecnico')
          throw new Error('Un supervisor solo puede crear técnicos');

        // RUT personal
        let rutNorm = null;
        if (row.rut) {
          if (!validarRut(row.rut)) throw new Error('RUT inválido (dígito verificador)');
          rutNorm = normalizarRut(row.rut);
          if (await db.perfilByRut(rutNorm)) throw new Error('Ese RUT ya está registrado');
        }

        // Email: el de la columna, o autogenerado a partir del RUT/nombre + slug de la empresa
        let email = row.email;
        if (!email) {
          const base = rutNorm ? rutNorm.replace(/[.\-]/g, '').toLowerCase()
                               : nombreCompleto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.');
          email = `${base}@${empresa.slug}.cl`;
        }

        // Supervisor (vínculo real por RUT, dentro de la misma empresa)
        let supervisor_id = null;
        if (row.rutSup) {
          const rs = normalizarRut(row.rutSup);
          if (supRutMap[rs]) supervisor_id = supRutMap[rs];
          else {
            const perfilSup = await db.perfilByRut(rs);
            if (perfilSup) {
              const u = await db.usuarioById(perfilSup.usuario_id);
              if (u && u.empresa_id === empresa.id) supervisor_id = u.id;
            }
          }
          if (!supervisor_id) throw new Error('Supervisor no encontrado por su RUT en esta empresa');
        }

        // Proyecto a asignar (opcional): se valida contra los proyectos de la empresa
        let proyecto = null;
        if (row.proyectoNom) {
          const proys = await proyectosDe(empresa.id);
          const objetivo = row.proyectoNom.toLowerCase();
          proyecto = proys.find(p => (p.nombre || '').toLowerCase() === objetivo)
                  || proys.find(p => (p.slug || '').toLowerCase() === objetivo);
          if (!proyecto) throw new Error('Proyecto no encontrado en la empresa: ' + row.proyectoNom);
        }

        // Contraseña temporal: el RUT sin puntos ni guión (o aleatoria si no hay RUT)
        const temporal = rutNorm ? rutNorm.replace(/[.\-]/g, '') : 'Tmp' + Math.random().toString(36).slice(2, 8);
        const password_hash = await bcrypt.hash(temporal, 12);

        const usuario = await db.usuarioInsert({
          nombre: nombreCompleto, email, password_hash, rol: row.rol,
          empresa_id: empresa.id, supervisor_id, activo: true
        });
        await db.perfilUpsert({
          usuario_id: usuario.id, rut: rutNorm, nombre: row.nombre || null,
          apellidos: row.apellido || null, cargo: row.cargo || null
        });
        if (row.rol === 'supervisor' && rutNorm) supRutMap[rutNorm] = usuario.id;

        // Asignación al proyecto (la rama del proyecto define preventivo/correctivo)
        if (proyecto) {
          const rolEnProy = row.rol === 'supervisor' ? 'supervisor' : 'tecnico';
          await db.asignacionUpsert(usuario.id, proyecto.id, rolEnProy);
        }

        creados.push({ fila: row.fila, nombre: nombreCompleto, email, rol: row.rol, password_temporal: temporal, proyecto: proyecto?.nombre || null });
      } catch (e) {
        const msg = /unique|duplicate/i.test(e.message) ? 'Email ya registrado' : e.message;
        errores.push({ fila: row.fila, nombre: nombreCompleto || '(sin nombre)', error: msg });
      }
    }
    res.json({ ok: true, total: filas.length, creados, errores });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /api/usuarios/:id/invitacion — reenviar invitación (modo A)
// Genera credenciales temporales y las devuelve para compartir con el usuario.
// (Si más adelante se configura SMTP server-side, aquí se envía el correo.)
router.post('/usuarios/:id/invitacion', adminEmpresa, async (req, res) => {
  try {
    const usuario = await db.usuarioById(req.params.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (req.user.rol === 'admin_empresa' && usuario.empresa_id !== req.user.empresa_id)
      return res.status(403).json({ error: 'Ese usuario no pertenece a tu empresa' });
    const temporal = 'Tmp-' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89);
    const password_hash = await bcrypt.hash(temporal, 12);
    await db.usuarioUpdate(usuario.id, { password_hash });
    res.json({
      ok: true, modo: 'A', email: usuario.email,
      password_temporal: temporal,
      mensaje: 'Comparte estas credenciales con el usuario. Deberá cambiarlas al ingresar.'
    });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
