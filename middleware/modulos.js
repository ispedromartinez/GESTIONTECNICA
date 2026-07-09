// middleware/modulos.js
// Bloquea rutas de un módulo (Tigo/WOM/Preventivo) si la empresa del
// usuario no tiene una fila en `proyectos` con ese `template`.
// Debe montarse SIEMPRE después de authMiddleware (necesita req.user).
const gestionDb = require('../db/gestion');

function requireModulo(nombre) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (req.user.rol === 'superadmin') return next();
    try {
      const propios = await gestionDb.proyectosByEmpresa(req.user.empresa_id);
      const tiene = propios.some(p => p.template === nombre && p.estado !== 'inactivo');
      if (!tiene) {
        return res.status(403).json({ error: `Tu empresa no tiene el módulo ${nombre} habilitado` });
      }
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { requireModulo };
