const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-CAMBIAR-en-produccion';

// Valida el Bearer token y adjunta req.user
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// Verifica que el usuario tenga acceso al área solicitada.
// superadmin y admin_empresa pasan siempre.
// supervisor y tecnico deben tener el area_id en su lista.
function requireArea(paramName = 'area_id') {
  return (req, res, next) => {
    const { rol, areas_permitidas } = req.user;
    if (rol === 'superadmin' || rol === 'admin_empresa') return next();

    const areaId =
      req.params[paramName] || req.body[paramName] || req.query[paramName];
    if (!areaId) return res.status(400).json({ error: 'area_id requerido' });

    if (!areas_permitidas || !areas_permitidas.includes(areaId)) {
      return res.status(403).json({ error: 'Sin acceso a esta área' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireArea, JWT_SECRET };
