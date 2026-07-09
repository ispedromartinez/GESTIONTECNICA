const gestionDb = require('../db/gestion');

// Bloquea el acceso a un módulo legacy fijo (tigo/wom/preventivo) si la
// empresa del usuario no lo tiene habilitado. superadmin pasa siempre
// (administra todos los módulos de todas las empresas).
function requireModulo(modulo) {
  const campo = 'modulo_' + modulo;
  return async (req, res, next) => {
    try {
      if (req.user.rol === 'superadmin') return next();
      const empresa = await gestionDb.empresaById(req.user.empresa_id);
      if (empresa && (empresa[campo] === 0 || empresa[campo] === false)) {
        return res.status(403).json({ error: `Tu empresa no tiene habilitado el módulo ${modulo}` });
      }
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { requireModulo };
