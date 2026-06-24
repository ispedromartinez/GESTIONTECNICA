const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { requireRol } = require('../middleware/roles');
const { validarRut, normalizarRut } = require('../utils/rut');
const db = require('../db/gestion');

const router = express.Router();
router.use(authMiddleware); // todas las rutas requieren sesión

const ROLES_ADMIN = ['superadmin', 'admin_empresa'];
const esAdmin = rol => ROLES_ADMIN.includes(rol);

// ── Helper: carga un proyecto y aplica la REGLA 1 ──────────────
// Un usuario solo accede a proyectos de SU empresa (superadmin: todos).
async function cargarProyecto(req, res, next) {
  try {
    const proyecto = await db.proyectoById(req.params.id || req.params.proyecto_id);
    if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (req.user.rol !== 'superadmin' && proyecto.empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Proyecto fuera de tu empresa' });
    }
    req.proyecto = proyecto;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ════════════════════════════════════════════════════════════════
// PERFILES  (Reglas 4 y 5)
// ════════════════════════════════════════════════════════════════

// GET /api/gestion/perfil — mi propio perfil
router.get('/perfil', async (req, res) => {
  try {
    res.json(await db.perfilByUsuario(req.user.usuario_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/gestion/perfil — editar mi propio perfil
router.put('/perfil', (req, res) => guardarPerfil(req, res, req.user.usuario_id));

// PUT /api/gestion/perfil/:usuario_id — REGLA 5: solo admin edita ajenos
router.put('/perfil/:usuario_id', requireRol(...ROLES_ADMIN), (req, res) =>
  guardarPerfil(req, res, req.params.usuario_id));

// Lógica común de guardado con validación de RUT (REGLA 4)
async function guardarPerfil(req, res, usuario_id) {
  try {
    const { rut, nombre, apellidos, telefono, cargo } = req.body;
    let rutNorm = null;

    if (rut) {
      if (!validarRut(rut))
        return res.status(400).json({ error: 'RUT inválido (dígito verificador incorrecto)' });
      rutNorm = normalizarRut(rut);
      // REGLA 4: unicidad — excluye al propio usuario al editar
      const dueño = await db.perfilByRut(rutNorm, usuario_id);
      if (dueño) return res.status(409).json({ error: 'Ese RUT ya está registrado' });
    }

    const perfil = await db.perfilUpsert({
      usuario_id, rut: rutNorm, nombre, apellidos, telefono, cargo
    });
    res.json({ ok: true, perfil });
  } catch (err) { res.status(400).json({ error: err.message }); }
}

// ════════════════════════════════════════════════════════════════
// DASHBOARD / VISTAS PROPIAS  (recorte por rol)
// ════════════════════════════════════════════════════════════════

// GET /api/gestion/resumen — métricas del dashboard, según rol
router.get('/resumen', async (req, res) => {
  try {
    const { rol, empresa_id, usuario_id } = req.user;
    if (rol === 'superadmin') {
      const [empresas, proyectos, recientes] = await Promise.all([
        db.empresasList(), db.proyectosAll(), db.informesRecientes(5)
      ]);
      return res.json({
        empresas: empresas.length,
        proyectos_activos: proyectos.filter(p => p.estado === 'activo').length,
        proyectos_total: proyectos.length,
        informes_recientes: recientes
      });
    }
    if (rol === 'admin_empresa') {
      const [proyectos, recientes] = await Promise.all([
        db.proyectosByEmpresa(empresa_id), db.informesRecientes(5, empresa_id)
      ]);
      return res.json({
        empresas: 1,
        proyectos_activos: proyectos.filter(p => p.estado === 'activo').length,
        proyectos_total: proyectos.length,
        informes_recientes: recientes
      });
    }
    // supervisor / tecnico: lo suyo
    const [misProyectos, misInformes] = await Promise.all([
      db.misProyectos(usuario_id), db.misInformes(usuario_id)
    ]);
    res.json({
      proyectos_total: misProyectos.length,
      proyectos_activos: misProyectos.filter(p => p.estado === 'activo').length,
      informes_total: misInformes.length,
      informes_recientes: misInformes.slice(0, 5)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/gestion/mis-proyectos — proyectos asignados al usuario
router.get('/mis-proyectos', async (req, res) => {
  try {
    res.json(await db.misProyectos(req.user.usuario_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/gestion/mis-informes — informes donde soy técnico/supervisor
router.get('/mis-informes', async (req, res) => {
  try {
    res.json(await db.misInformes(req.user.usuario_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════
// PROYECTOS  (Regla 1)
// ════════════════════════════════════════════════════════════════

// GET /api/gestion/proyectos — REGLA 1: solo los de mi empresa
// superadmin sin empresa_id => todos; con empresa_id => esa empresa
router.get('/proyectos', async (req, res) => {
  try {
    if (req.user.rol === 'superadmin') {
      return res.json(req.query.empresa_id
        ? await db.proyectosByEmpresa(req.query.empresa_id)
        : await db.proyectosAll());
    }
    if (!req.user.empresa_id) return res.status(400).json({ error: 'empresa_id requerido' });
    res.json(await db.proyectosByEmpresa(req.user.empresa_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/gestion/proyectos/:id
router.get('/proyectos/:id', cargarProyecto, (req, res) => res.json(req.proyecto));

// POST /api/gestion/proyectos — solo admin; empresa forzada a la suya
router.post('/proyectos', requireRol(...ROLES_ADMIN), async (req, res) => {
  try {
    const { nombre, slug, estado, fecha_inicio, logo, template, color } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    const empresa_id = req.user.rol === 'superadmin'
      ? req.body.empresa_id
      : req.user.empresa_id;
    if (!empresa_id) return res.status(400).json({ error: 'empresa_id requerido' });

    const proyecto = await db.proyectoInsert({
      empresa_id, nombre, slug, estado, fecha_inicio, logo, template, color
    });
    res.json({ ok: true, proyecto });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PUT /api/gestion/proyectos/:id — editar proyecto (solo admin).
// Reasignar empresa (empresa_id) queda reservado a superadmin.
router.put('/proyectos/:id', cargarProyecto, requireRol(...ROLES_ADMIN), async (req, res) => {
  try {
    const { nombre, slug, estado, fecha_inicio, empresa_id } = req.body;
    const fields = {};
    if (nombre !== undefined) fields.nombre = nombre;
    if (slug !== undefined) fields.slug = slug || null;
    if (estado !== undefined) fields.estado = estado;
    if (fecha_inicio !== undefined) fields.fecha_inicio = fecha_inicio || null;
    if (empresa_id !== undefined && req.user.rol === 'superadmin') fields.empresa_id = empresa_id;
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nada para actualizar' });
    const proyecto = await db.proyectoUpdate(req.params.id, fields);
    res.json({ ok: true, proyecto });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/gestion/proyectos/:id/personal — REGLA 2
// Técnicos/supervisores de la empresa del proyecto Y asignados a él.
router.get('/proyectos/:id/personal', cargarProyecto, async (req, res) => {
  try {
    res.json(await db.personalDeProyecto(req.proyecto.id, req.proyecto.empresa_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════
// ASIGNACIONES  (usuario <-> proyecto)
// ════════════════════════════════════════════════════════════════

// POST /api/gestion/proyectos/:id/asignaciones — solo admin
router.post('/proyectos/:id/asignaciones', cargarProyecto, requireRol(...ROLES_ADMIN), async (req, res) => {
  try {
    const { usuario_id, rol_en_proyecto } = req.body;
    if (!usuario_id) return res.status(400).json({ error: 'usuario_id requerido' });
    const asignacion = await db.asignacionUpsert(usuario_id, req.proyecto.id, rol_en_proyecto);
    res.json({ ok: true, asignacion });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/gestion/proyectos/:id/asignaciones/:usuario_id — solo admin
router.delete('/proyectos/:id/asignaciones/:usuario_id', cargarProyecto, requireRol(...ROLES_ADMIN), async (req, res) => {
  try {
    await db.asignacionRemove(req.params.usuario_id, req.proyecto.id);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════
// INFORMES  (Reglas 2 y 3)
// ════════════════════════════════════════════════════════════════

// GET /api/gestion/proyectos/:id/informes — REGLA 3: siempre por proyecto
router.get('/proyectos/:id/informes', cargarProyecto, async (req, res) => {
  try {
    res.json(await db.informesByProyecto(req.proyecto.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/gestion/proyectos/:id/informes — crear informe
// REGLA 2: tecnico/supervisor deben pertenecer a la empresa del proyecto
//          Y estar asignados a ese proyecto.
router.post('/proyectos/:id/informes', cargarProyecto, async (req, res) => {
  try {
    const { titulo, contenido, tecnico_id, supervisor_id, estado } = req.body;
    if (!titulo) return res.status(400).json({ error: 'titulo requerido' });

    const personal = await db.personalDeProyecto(req.proyecto.id, req.proyecto.empresa_id);
    const idsValidos = new Set(personal.map(p => p.id));
    if (tecnico_id && !idsValidos.has(tecnico_id))
      return res.status(400).json({ error: 'El técnico no está asignado a este proyecto / empresa' });
    if (supervisor_id && !idsValidos.has(supervisor_id))
      return res.status(400).json({ error: 'El supervisor no está asignado a este proyecto / empresa' });

    const informe = await db.informeInsert({
      proyecto_id: req.proyecto.id, // REGLA 3: el informe queda atado al proyecto
      tecnico_id, supervisor_id, titulo, contenido, estado
    });
    res.json({ ok: true, informe });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/gestion/informes/:id — valida empresa vía el proyecto (Regla 1)
router.get('/informes/:id', async (req, res) => {
  try {
    const informe = await db.informeById(req.params.id);
    if (!informe) return res.status(404).json({ error: 'Informe no encontrado' });
    const proyecto = await db.proyectoById(informe.proyecto_id);
    if (req.user.rol !== 'superadmin' && (!proyecto || proyecto.empresa_id !== req.user.empresa_id))
      return res.status(403).json({ error: 'Informe fuera de tu empresa' });
    res.json(informe);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/gestion/informes/:id/estado
router.patch('/informes/:id/estado', async (req, res) => {
  try {
    const { estado } = req.body;
    const informe = await db.informeById(req.params.id);
    if (!informe) return res.status(404).json({ error: 'Informe no encontrado' });
    const proyecto = await db.proyectoById(informe.proyecto_id);
    if (req.user.rol !== 'superadmin' && (!proyecto || proyecto.empresa_id !== req.user.empresa_id))
      return res.status(403).json({ error: 'Informe fuera de tu empresa' });
    await db.informeUpdateEstado(informe.id, estado);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
