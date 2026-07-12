// middleware/modulos.js
// Bloquea rutas de un módulo (Tigo/WOM/Preventivo) si la empresa del
// usuario no tiene una fila en `proyectos` con ese `template`.
// Debe montarse SIEMPRE después de authMiddleware (necesita req.user).
const gestionDb = require('../db/gestion');

// Única fuente de verdad de los 3 módulos legacy fijos — requerida por
// routes/gestion.js (excluir del conteo de KPIs) y scripts/migrar-modulos-caro.js.
const MODULOS_FIJOS = ['tigo', 'wom', 'preventivo'];

function requireModulo(nombre) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (req.user.rol === 'superadmin') return next();
    if (!req.user.empresa_id) return res.status(400).json({ error: 'empresa_id requerido' });
    try {
      const propios = await gestionDb.proyectosByEmpresa(req.user.empresa_id);
      const proyecto = propios.find(p => p.template === nombre && p.estado === 'activo');
      if (!proyecto) {
        return res.status(403).json({ error: `Tu empresa no tiene el módulo ${nombre} habilitado` });
      }
      // admin_empresa administra toda su empresa: no necesita asignación individual.
      // supervisor/tecnico sí deben estar asignados a este módulo en particular.
      if (req.user.rol === 'admin_empresa') return next();
      const asignado = await gestionDb.asignacionExists(req.user.usuario_id, proyecto.id);
      if (!asignado) {
        return res.status(403).json({ error: `No tienes acceso asignado al módulo ${nombre}` });
      }
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { requireModulo, MODULOS_FIJOS };
