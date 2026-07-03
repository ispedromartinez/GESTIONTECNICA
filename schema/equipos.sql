-- Hoja de vida de equipos: tabla resumen poblada automáticamente al generar informes.
CREATE TABLE IF NOT EXISTS equipos (
  id                   TEXT PRIMARY KEY,
  empresa_id           UUID REFERENCES empresas(id) ON DELETE CASCADE,
  sitio                TEXT NOT NULL,
  numero               TEXT NOT NULL,
  clave                TEXT NOT NULL,
  tipo                 TEXT,
  marca                TEXT,
  modelo               TEXT,
  total_intervenciones INTEGER DEFAULT 0,
  primera_intervencion TEXT,
  ultima_intervencion  TEXT,
  creado_en            TIMESTAMPTZ DEFAULT now(),
  actualizado_en       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_id, clave)
);
CREATE INDEX IF NOT EXISTS idx_equipos_empresa ON equipos(empresa_id);

-- Columnas nuevas en los registros de informes para ligar informe→equipo:
ALTER TABLE informes_clima ADD COLUMN IF NOT EXISTS eq_numero TEXT;
ALTER TABLE informes_wom   ADD COLUMN IF NOT EXISTS equipo   TEXT;

-- LPU y circuito del informe TIGO (portados de INFORMECORRECTIVOS):
ALTER TABLE informes_clima ADD COLUMN IF NOT EXISTS lpu      TEXT;
ALTER TABLE informes_clima ADD COLUMN IF NOT EXISTS circuito TEXT;
