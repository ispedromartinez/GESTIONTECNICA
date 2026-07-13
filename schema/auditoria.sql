-- ================================================================
-- Log de auditoría: acciones sensibles (quién, qué, cuándo).
-- Ejecutar en Supabase SQL Editor. En modo local (sin Supabase) el log
-- va a auditoria.json automáticamente y no hace falta esto.
-- ================================================================
CREATE TABLE IF NOT EXISTS auditoria (
  id            TEXT PRIMARY KEY,
  fecha         TIMESTAMPTZ DEFAULT NOW(),
  usuario_id    UUID,
  usuario_email TEXT,
  empresa_id    UUID,
  accion        TEXT NOT NULL,   -- crear | borrar | activar_modulo | vincular | ...
  entidad       TEXT NOT NULL,   -- empresa | usuario | proyecto | modulo | ...
  entidad_id    TEXT,
  detalle       TEXT             -- JSON serializado con contexto extra
);
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha   ON auditoria(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_empresa ON auditoria(empresa_id);

ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
-- Backend con service_role key (bypasea RLS); scope por empresa_id en la ruta.
