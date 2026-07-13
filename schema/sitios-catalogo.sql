-- ================================================================
-- Catálogo de sitios de Preventivo, aislado por empresa.
-- Reemplaza el archivo compartido sitios_preventivos.xlsx (que se
-- filtraba entre todas las empresas). Ejecutar DESPUÉS de auth.sql.
-- ================================================================
CREATE TABLE IF NOT EXISTS sitios_catalogo (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  modulo      TEXT NOT NULL DEFAULT 'preventivo',  -- tigo | wom | preventivo
  clave       TEXT NOT NULL,   -- nombre|direccion|ciudad normalizado (dedup)
  nombre      TEXT NOT NULL,
  direccion   TEXT,
  ciudad      TEXT,
  criticidad  TEXT,
  categoria   TEXT,
  codigo      TEXT,
  creado_en   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(empresa_id, modulo, clave)
);
CREATE INDEX IF NOT EXISTS idx_sitios_catalogo_emp_mod ON sitios_catalogo(empresa_id, modulo);

-- Si la tabla ya existía sin la columna modulo (versión anterior):
-- ALTER TABLE sitios_catalogo ADD COLUMN IF NOT EXISTS modulo TEXT NOT NULL DEFAULT 'preventivo';
-- ALTER TABLE sitios_catalogo DROP CONSTRAINT IF EXISTS sitios_catalogo_empresa_id_clave_key;
-- ALTER TABLE sitios_catalogo ADD CONSTRAINT sitios_catalogo_emp_mod_clave_key UNIQUE(empresa_id, modulo, clave);

ALTER TABLE sitios_catalogo ENABLE ROW LEVEL SECURITY;
-- El backend usa la service_role key (bypasea RLS) y scopea por empresa_id
-- en cada endpoint. Agregar políticas si se usa anon/user key.
