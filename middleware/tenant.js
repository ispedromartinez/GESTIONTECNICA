// ════════════════════════════════════════════════════════════════
// TENANT — aislamiento multi-tenant centralizado.
//
// El "tenant" del sistema es la EMPRESA (`empresa_id`). Esta es la ÚNICA
// fuente de verdad de la regla de aislamiento: toda comprobación de
// pertenencia de datos a un tenant debe pasar por aquí, para que sea
// imposible olvidarla al agregar rutas nuevas.
//
// Regla:
//   · superadmin (empresa_id = null) → ve TODOS los tenants.
//   · resto → solo su propio tenant; recursos sin tenant (legado) NO se ven.
//   · Fail-closed: ante la duda, NO se ve (filtra de menos, nunca de más).
//
// Los helpers leen de `req.user` (que `authMiddleware` ya garantiza), así no
// dependen de un orden de montaje concreto. `tenantContext` es azúcar opcional
// que además expone `req.tenantId` / `req.isSuperadmin`.
// ════════════════════════════════════════════════════════════════

// Deriva el contexto de tenant de un request autenticado.
function tenantOf(req) {
  const u = (req && req.user) || {};
  const isSuperadmin = u.rol === 'superadmin';
  return { isSuperadmin, tenantId: isSuperadmin ? null : (u.empresa_id || null) };
}

// Extrae el tenant de una fila (admite snake `empresa_id` y camel `empresaId`).
function tenantIdOf(row) {
  if (!row) return null;
  return row.empresa_id != null ? row.empresa_id : (row.empresaId != null ? row.empresaId : null);
}

// ¿El recurso (identificado por su tenant) es accesible para este request?
function canAccessTenant(req, resourceTenantId) {
  const { isSuperadmin, tenantId } = tenantOf(req);
  if (isSuperadmin) return true;
  return !!resourceTenantId && resourceTenantId === tenantId;
}

// Filtra una lista de filas dejando solo las del tenant del request.
// `getTid` extrae el tenant de cada fila (por defecto detecta empresa_id/empresaId).
function scopeToTenant(req, rows, getTid = tenantIdOf) {
  const { isSuperadmin } = tenantOf(req);
  if (isSuperadmin) return rows || [];
  return (rows || []).filter(r => canAccessTenant(req, getTid(r)));
}

// Middleware opcional: expone req.tenantId / req.isSuperadmin. Montar DESPUÉS
// de authMiddleware. No bloquea (el aislamiento real lo hacen los helpers).
function tenantContext(req, _res, next) {
  Object.assign(req, tenantOf(req));
  next();
}

module.exports = { tenantOf, tenantIdOf, canAccessTenant, scopeToTenant, tenantContext };
