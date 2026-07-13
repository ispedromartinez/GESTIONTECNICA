-- ================================================================
-- TABLAS BASE DE INFORMES (Clima/Tigo y WOM) + sus papeleras
-- Ejecutar en Supabase SQL Editor DESPUÉS de auth.sql, ANTES de
-- extension.sql y equipos.sql (que les agregan columnas vía ALTER).
-- id es TEXT (no UUID): el backend genera Date.now().toString().
-- ================================================================

CREATE TABLE IF NOT EXISTS informes_clima (
  id              TEXT PRIMARY KEY,
  fecha           TEXT,
  fecha_creacion  TIMESTAMPTZ DEFAULT NOW(),
  cod_informe     TEXT,
  nombre_sitio    TEXT,
  codigo_sitio    TEXT,
  tecnico         TEXT,
  supervisor      TEXT,
  num_ot          TEXT,
  photo_count     INTEGER DEFAULT 0,
  filename        TEXT
);

CREATE TABLE IF NOT EXISTS papelera_clima (
  id              TEXT PRIMARY KEY,
  fecha           TEXT,
  fecha_creacion  TIMESTAMPTZ,
  cod_informe     TEXT,
  nombre_sitio    TEXT,
  codigo_sitio    TEXT,
  tecnico         TEXT,
  supervisor      TEXT,
  num_ot          TEXT,
  photo_count     INTEGER DEFAULT 0,
  filename        TEXT,
  fecha_eliminado TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS informes_wom (
  id              TEXT PRIMARY KEY,
  fecha_creacion  TIMESTAMPTZ DEFAULT NOW(),
  ticket          TEXT,
  cod_interno     TEXT,
  fecha_inicio    TEXT,
  instalacion     TEXT,
  tipo_actividad  TEXT,
  tecnicos        TEXT,
  photo_count     INTEGER DEFAULT 0,
  filename        TEXT
);

CREATE TABLE IF NOT EXISTS papelera_wom (
  id              TEXT PRIMARY KEY,
  fecha_creacion  TIMESTAMPTZ,
  ticket          TEXT,
  cod_interno     TEXT,
  fecha_inicio    TEXT,
  instalacion     TEXT,
  tipo_actividad  TEXT,
  tecnicos        TEXT,
  photo_count     INTEGER DEFAULT 0,
  filename        TEXT,
  fecha_eliminado TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_informes_clima_fecha  ON informes_clima(fecha_creacion DESC);
CREATE INDEX IF NOT EXISTS idx_informes_wom_fecha    ON informes_wom(fecha_creacion DESC);
CREATE INDEX IF NOT EXISTS idx_papelera_clima_fecha  ON papelera_clima(fecha_eliminado DESC);
CREATE INDEX IF NOT EXISTS idx_papelera_wom_fecha    ON papelera_wom(fecha_eliminado DESC);

ALTER TABLE informes_clima ENABLE ROW LEVEL SECURITY;
ALTER TABLE informes_wom   ENABLE ROW LEVEL SECURITY;
ALTER TABLE papelera_clima ENABLE ROW LEVEL SECURITY;
ALTER TABLE papelera_wom   ENABLE ROW LEVEL SECURITY;
-- El backend usa la service_role key que bypasea RLS (igual que el resto
-- de las tablas). Agregar políticas si se usa anon/user key desde el cliente.
