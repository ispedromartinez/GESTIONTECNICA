const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { requireRol } = require('../middleware/roles');
const { canAccessTenant } = require('../middleware/tenant');
const { validarRut, normalizarRut } = require('../utils/rut');
const db = require('../db/gestion');

const router = express.Router();
router.use(authMiddleware); // todas las rutas requieren sesión

const ROLES_ADMIN = ['superadmin', 'admin_empresa'];
const esAdmin = rol => ROLES_ADMIN.includes(rol);

// Rama del proyecto: los informes heredan esta clasificación de su proyecto.
const TIPOS_PROYECTO = ['correctivo', 'preventivo', 'temporal'];
// Categoría / especialidad del proyecto.
const CATEGORIAS_PROYECTO = ['clima', 'energia', 'obras_civiles'];

// ── Helper: carga un proyecto y aplica la REGLA 1 ──────────────
// Un usuario solo accede a proyectos de SU empresa (superadmin: todos).
async function cargarProyecto(req, res, next) {
  try {
    const proyecto = await db.proyectoById(req.params.id || req.params.proyecto_id);
    if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (!canAccessTenant(req, proyecto.empresa_id)) {
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

// Agrega un listado de informes en métricas listas para graficar.
// Cada informe aporta: estado, rama (proyecto_tipo), proyecto, mes y sitio.
function agregarInformes(informes) {
  const porEstado = {};
  const porTipo = {};
  const porProyecto = {};
  const sitios = new Set();
  const porMes = {};
  // Claves de los últimos 6 meses (AAAA-MM), de más antiguo a más reciente.
  const meses = [];
  const hoy = new Date();
  for (let k = 5; k >= 0; k--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - k, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    meses.push(key);
    porMes[key] = 0;
  }
  for (const i of (informes || [])) {
    const estado = i.estado || 'borrador';
    porEstado[estado] = (porEstado[estado] || 0) + 1;
    const tipo = i.proyecto_tipo || 'otros';
    porTipo[tipo] = (porTipo[tipo] || 0) + 1;
    const proy = i.proyecto_nombre || '—';
    porProyecto[proy] = (porProyecto[proy] || 0) + 1;
    const mes = String(i.fecha_creacion || '').slice(0, 7);
    if (mes in porMes) porMes[mes]++;
    const sitio = (i.sitio || '').toString().trim();
    if (sitio) sitios.add(sitio.toLowerCase());
  }
  const topSitios = {};
  for (const i of (informes || [])) {
    const sitio = (i.sitio || '').toString().trim();
    if (sitio) topSitios[sitio] = (topSitios[sitio] || 0) + 1;
  }
  return {
    total: (informes || []).length,
    por_estado: porEstado,
    por_tipo: porTipo,
    por_mes: meses.map(m => ({ mes: m, count: porMes[m] })),
    por_proyecto: Object.entries(porProyecto)
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([nombre, count]) => ({ nombre, count })),
    top_sitios: Object.entries(topSitios)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([nombre, count]) => ({ nombre, count })),
    sitios_distintos: sitios.size
  };
}

// GET /api/gestion/resumen — métricas del dashboard, según rol
router.get('/resumen', async (req, res) => {
  try {
    const { rol, empresa_id, usuario_id } = req.user;
    if (rol === 'superadmin') {
      const [empresas, proyectos, recientes, todos] = await Promise.all([
        db.empresasList(), db.proyectosAll(), db.informesRecientes(12), db.informesParaStats()
      ]);
      return res.json({
        empresas: empresas.length,
        proyectos_activos: proyectos.filter(p => p.estado === 'activo').length,
        proyectos_total: proyectos.length,
        informes_recientes: recientes,
        stats: agregarInformes(todos)
      });
    }
    if (rol === 'admin_empresa') {
      const [proyectos, recientes, todos] = await Promise.all([
        db.proyectosByEmpresa(empresa_id), db.informesRecientes(12, empresa_id), db.informesParaStats(empresa_id)
      ]);
      return res.json({
        empresas: 1,
        proyectos_activos: proyectos.filter(p => p.estado === 'activo').length,
        proyectos_total: proyectos.length,
        informes_recientes: recientes,
        stats: agregarInformes(todos)
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
      informes_recientes: misInformes.slice(0, 12),
      stats: agregarInformes(misInformes)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/gestion/mis-proyectos — proyectos asignados al usuario
router.get('/mis-proyectos', async (req, res) => {
  try {
    res.json(await db.misProyectos(req.user.usuario_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/gestion/asignaciones-mapa — mapa usuario↔proyecto de la empresa (admin)
router.get('/asignaciones-mapa', requireRol(...ROLES_ADMIN), async (req, res) => {
  try {
    const empresa_id = req.user.rol === 'superadmin'
      ? (req.query.empresa_id || null) : req.user.empresa_id;
    res.json(await db.asignacionesPorEmpresa(empresa_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/gestion/usuarios/:id/proyectos — proyectos asignados a un usuario (admin)
router.get('/usuarios/:id/proyectos', requireRol(...ROLES_ADMIN), async (req, res) => {
  try {
    const u = await db.usuarioById(req.params.id);
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!canAccessTenant(req, u.empresa_id))
      return res.status(403).json({ error: 'Usuario fuera de tu empresa' });
    res.json(await db.misProyectos(req.params.id));
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
    const { nombre, slug, estado, fecha_inicio, logo, template, color, tipo, categoria } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
    if (tipo !== undefined && tipo !== null && !TIPOS_PROYECTO.includes(tipo))
      return res.status(400).json({ error: 'tipo inválido' });
    if (categoria !== undefined && categoria !== null && !CATEGORIAS_PROYECTO.includes(categoria))
      return res.status(400).json({ error: 'categoría inválida' });
    const empresa_id = req.user.rol === 'superadmin'
      ? req.body.empresa_id
      : req.user.empresa_id;
    if (!empresa_id) return res.status(400).json({ error: 'empresa_id requerido' });

    const proyecto = await db.proyectoInsert({
      empresa_id, nombre, slug, estado, fecha_inicio, logo, template, color, tipo, categoria
    });
    res.json({ ok: true, proyecto });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PUT /api/gestion/proyectos/:id — editar proyecto (solo admin).
// Reasignar empresa (empresa_id) queda reservado a superadmin.
router.put('/proyectos/:id', cargarProyecto, requireRol(...ROLES_ADMIN), async (req, res) => {
  try {
    // El slug es la clave usada para el archivo de registro y el logo del
    // proyecto en el flujo legado (server.js) — no se puede reasignar una
    // vez creado el proyecto para no desincronizar esas referencias.
    const { nombre, estado, fecha_inicio, empresa_id, tipo, categoria, oculto, logo } = req.body;
    const fields = {};
    if (nombre !== undefined) fields.nombre = nombre;
    if (oculto !== undefined) fields.oculto = oculto ? 1 : 0;
    if (estado !== undefined) fields.estado = estado;
    if (fecha_inicio !== undefined) fields.fecha_inicio = fecha_inicio || null;
    if (logo !== undefined) fields.logo = logo || null;
    if (tipo !== undefined) {
      if (tipo !== null && !TIPOS_PROYECTO.includes(tipo))
        return res.status(400).json({ error: 'tipo inválido' });
      fields.tipo = tipo || null;
    }
    if (categoria !== undefined) {
      if (categoria !== null && !CATEGORIAS_PROYECTO.includes(categoria))
        return res.status(400).json({ error: 'categoría inválida' });
      fields.categoria = categoria || null;
    }
    if (empresa_id !== undefined && req.user.rol === 'superadmin') fields.empresa_id = empresa_id;
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nada para actualizar' });
    const proyecto = await db.proyectoUpdate(req.params.id, fields);
    res.json({ ok: true, proyecto });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/gestion/proyectos/:id — borrar proyecto (superadmin y admin_empresa).
// cargarProyecto ya valida que el proyecto sea de la empresa del usuario.
router.delete('/proyectos/:id', cargarProyecto, requireRol(...ROLES_ADMIN), async (req, res) => {
  try {
    await db.proyectoDelete(req.proyecto.id);
    res.json({ ok: true });
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
    const informes = await db.informesByProyecto(req.proyecto.id);
    // Enriquecer con el nombre del técnico/supervisor responsable (id → nombre).
    const usuarios = await db.usuariosList(req.proyecto.empresa_id);
    const nombrePorId = {};
    (usuarios || []).forEach(u => { nombrePorId[u.id] = u.nombre; });
    res.json((informes || []).map(i => ({
      ...i,
      tecnico_nombre: nombrePorId[i.tecnico_id] || null,
      supervisor_nombre: nombrePorId[i.supervisor_id] || null
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/gestion/proyectos/:id/informes — crear informe
// REGLA 2: tecnico/supervisor deben pertenecer a la empresa del proyecto
//          Y estar asignados a ese proyecto.
router.post('/proyectos/:id/informes', cargarProyecto, async (req, res) => {
  try {
    const { titulo, contenido, tecnico_id, supervisor_id, estado, sitio, lpu } = req.body;
    if (!titulo) return res.status(400).json({ error: 'titulo requerido' });

    const personal = await db.personalDeProyecto(req.proyecto.id, req.proyecto.empresa_id);
    const idsValidos = new Set(personal.map(p => p.id));
    if (tecnico_id && !idsValidos.has(tecnico_id))
      return res.status(400).json({ error: 'El técnico no está asignado a este proyecto / empresa' });
    if (supervisor_id && !idsValidos.has(supervisor_id))
      return res.status(400).json({ error: 'El supervisor no está asignado a este proyecto / empresa' });

    const informe = await db.informeInsert({
      proyecto_id: req.proyecto.id, // REGLA 3: el informe queda atado al proyecto
      tecnico_id, supervisor_id, titulo, contenido, estado, sitio, lpu
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
    if (!canAccessTenant(req, proyecto && proyecto.empresa_id))
      return res.status(403).json({ error: 'Informe fuera de tu empresa' });
    res.json(informe);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/gestion/informes/:id/estado
const ESTADOS_INFORME = ['borrador', 'enviado', 'aprobado', 'rechazado'];
router.patch('/informes/:id/estado', async (req, res) => {
  try {
    const { estado } = req.body;
    if (!ESTADOS_INFORME.includes(estado))
      return res.status(400).json({ error: 'Estado no válido' });
    const informe = await db.informeById(req.params.id);
    if (!informe) return res.status(404).json({ error: 'Informe no encontrado' });
    const proyecto = await db.proyectoById(informe.proyecto_id);
    if (!canAccessTenant(req, proyecto && proyecto.empresa_id))
      return res.status(403).json({ error: 'Informe fuera de tu empresa' });
    // El técnico solo opera sobre SUS informes y solo puede generar/cerrar
    // (borrador→enviado "generar", enviado→aprobado "cerrar").
    if (req.user.rol === 'tecnico') {
      if (informe.tecnico_id !== req.user.usuario_id)
        return res.status(403).json({ error: 'No es tu informe' });
      if (!['enviado', 'aprobado'].includes(estado))
        return res.status(403).json({ error: 'Transición no permitida para técnico' });
    }
    await db.informeUpdateEstado(informe.id, estado);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PATCH /api/gestion/informes/:id/tecnico — reasignar el técnico responsable
// (lo saca del anterior y lo pone en el nuevo). Igual que crear un informe,
// el nuevo técnico debe ser personal asignado al proyecto (Regla 2). No lo
// puede hacer un técnico (solo quien gestiona el proyecto: supervisor+).
router.patch('/informes/:id/tecnico', async (req, res) => {
  try {
    if (req.user.rol === 'tecnico')
      return res.status(403).json({ error: 'No puedes reasignar informes' });
    const { tecnico_id } = req.body;
    const informe = await db.informeById(req.params.id);
    if (!informe) return res.status(404).json({ error: 'Informe no encontrado' });
    const proyecto = await db.proyectoById(informe.proyecto_id);
    if (!canAccessTenant(req, proyecto && proyecto.empresa_id))
      return res.status(403).json({ error: 'Informe fuera de tu empresa' });
    if (tecnico_id) {
      const personal = await db.personalDeProyecto(informe.proyecto_id, proyecto.empresa_id);
      if (!personal.some(p => p.id === tecnico_id))
        return res.status(400).json({ error: 'El técnico no está asignado a este proyecto / empresa' });
    }
    await db.informeUpdateTecnico(informe.id, tecnico_id || null);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
