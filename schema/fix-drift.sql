-- ================================================================
-- Columnas que el backend local (SQLite, db/local.js) migra sobre la
-- marcha con ALTER TABLE, pero que faltaban en los schema/*.sql de
-- Supabase. Ejecutar DESPUÉS de auth.sql/informes.sql/extension.sql.
-- ================================================================

-- Datos comerciales de la empresa
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS nombre_fantasia TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS contacto TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS correo TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS direccion TEXT;

-- Vínculo técnico → supervisor
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS supervisor_id UUID REFERENCES usuarios(id) ON DELETE SET NULL;

-- Rama y categoría del proyecto
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS tipo TEXT;
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS oculto BOOLEAN DEFAULT false;

-- Sitio/LPU y documento generado del informe de gestión
ALTER TABLE informes ADD COLUMN IF NOT EXISTS sitio TEXT;
ALTER TABLE informes ADD COLUMN IF NOT EXISTS lpu TEXT;
ALTER TABLE informes ADD COLUMN IF NOT EXISTS doc_url TEXT;
ALTER TABLE informes ADD COLUMN IF NOT EXISTS doc_nombre TEXT;
ALTER TABLE informes ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ;
