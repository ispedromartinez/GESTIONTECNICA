const express = require('express');
const bcrypt = require('bcryptjs');
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
    slug = (slug || nombre).toLowerCase().trim()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) return res.status(400).json({ error: 'slug inválido' });

    let rutNorm = null;
    if (rut_empresa) {
      if (!validarRut(rut_empresa))
        return res.status(400).json({ error: 'RUT de empresa inválido (dígito verificador)' });
      rutNorm = normalizarRut(rut_empresa);
      const existe = (await db.empresasListAll()).find(e => e.rut_empresa === rutNorm);
      if (existe) return res.status(409).json({ error: 'Ya existe una empresa con ese RUT' });
    }
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
      if (rut_empresa) {
        if (!validarRut(rut_empresa))
          return res.status(400).json({ error: 'RUT de empresa inválido' });
        const rutNorm = normalizarRut(rut_empresa);
        const otra = (await db.empresasListAll()).find(e => e.rut_empresa === rutNorm && e.id !== req.params.id);
        if (otra) return res.status(409).json({ error: 'Ese RUT ya pertenece a otra empresa' });
        fields.rut_empresa = rutNorm;
      } else fields.rut_empresa = null;
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

// POST /api/usuarios — crear usuario (campos de la tabla)
router.post('/usuarios', adminEmpresa, async (req, res) => {
  try {
    const { nombre, email, password } = req.body;
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

    const password_hash = await bcrypt.hash(password, 12);
    const usuario = await db.usuarioInsert({
      nombre, email: email.toLowerCase().trim(), password_hash, rol,
      empresa_id: rol === 'superadmin' ? null : empresa_id, activo: true
    });
    res.json({ ok: true, usuario });
  } catch (err) {
    const msg = /unique|duplicate/i.test(err.message) ? 'Ese correo ya está en uso' : err.message;
    res.status(400).json({ error: msg });
  }
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
