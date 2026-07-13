-- ================================================================
-- Relación supervisor ↔ técnico (muchos-a-muchos).
-- Un técnico puede estar a cargo de varios supervisores. Solo el admin
-- crea/borra estos vínculos. Ejecutar DESPUÉS de auth.sql.
-- Los nombres de FK (supervisor_tecnico_tecnico_id_fkey) los usa PostgREST
-- para el embed usuarios!... en db/gestion.js — no renombrar.
-- ================================================================
CREATE TABLE IF NOT EXISTS supervisor_tecnico (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID REFERENCES empresas(id) ON DELETE CASCADE,
  supervisor_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tecnico_id    UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creado_en     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(supervisor_id, tecnico_id)
);
CREATE INDEX IF NOT EXISTS idx_suptec_supervisor ON supervisor_tecnico(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_suptec_tecnico    ON supervisor_tecnico(tecnico_id);

ALTER TABLE supervisor_tecnico ENABLE ROW LEVEL SECURITY;
-- Backend con service_role key (bypasea RLS); scope por empresa_id en las rutas.
