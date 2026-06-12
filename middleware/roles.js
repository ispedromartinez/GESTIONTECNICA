const JERARQUIA = {
  superadmin:    4,
  admin_empresa: 3,
  supervisor:    2,
  tecnico:       1
};

// Permite solo los roles listados
function requireRol(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (!roles.includes(req.user.rol)) {
      return res.status(403).json({
        error: `Rol insuficiente. Requiere: ${roles.join(' o ')}`
      });
    }
    next();
  };
}

// Permite roles con nivel >= nivelMinimo
// Ej: requireNivel(3) => admin_empresa o superadmin
function requireNivel(nivelMinimo) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    const nivel = JERARQUIA[req.user.rol] || 0;
    if (nivel < nivelMinimo) {
      return res.status(403).json({ error: 'Permisos insuficientes' });
    }
    next();
  };
}

// Garantiza que el usuario solo opere dentro de su propia empresa.
// Si la ruta tiene :empresa_id o body.empresa_id, lo compara con el del token.
function requireMismaEmpresa(req, res, next) {
  const { rol, empresa_id } = req.user;
  if (rol === 'superadmin') return next();
  const target = req.params.empresa_id || req.body.empresa_id;
  if (target && target !== empresa_id) {
    return res.status(403).json({ error: 'Acceso denegado: empresa no autorizada' });
  }
  next();
}

module.exports = { requireRol, requireNivel, requireMismaEmpresa, JERARQUIA };
