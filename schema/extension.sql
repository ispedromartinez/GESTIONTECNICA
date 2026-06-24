-- ================================================================
-- EXTENSIÓN DEL MODELO: PERFILES, PROYECTOS, ASIGNACIONES, INFORMES
-- Ejecutar en Supabase SQL Editor DESPUÉS de auth.sql
-- ================================================================
-- Reutiliza empresas/usuarios existentes. No toca informes_clima
-- ni informes_wom (tablas específicas heredadas).
-- ================================================================

-- 0. EMPRESAS: agregar RUT (idempotente)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS rut_empresa VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS idx_empresas_rut
  ON empresas(rut_empresa) WHERE rut_empresa IS NOT NULL;

-- 1. PERFILES (1:1 con usuarios)
-- usuario_id es UNIQUE → relación uno a uno
CREATE TABLE IF NOT EXISTS perfiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  rut         VARCHAR(20),   -- único vía idx_perfiles_rut (regla de negocio 4)
  nombre      VARCHAR(255),
  apellidos   VARCHAR(255),
  telefono    VARCHAR(50),
  cargo       VARCHAR(100),
  creado_en   TIMESTAMPTZ DEFAULT NOW()
);

-- 2. PROYECTOS (pertenecen a una empresa)
-- Reemplaza proyectos.json; conserva campos que la app ya usa.
CREATE TABLE IF NOT EXISTS proyectos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre        VARCHAR(255) NOT NULL,
  slug          VARCHAR(120),
  estado        VARCHAR(30) NOT NULL DEFAULT 'activo'
                  CHECK (estado IN ('planificado','activo','pausado','finalizado','cancelado')),
  fecha_inicio  DATE,
  -- Campos heredados de proyectos.json (presentación)
  logo          TEXT,
  template      VARCHAR(50),
  color         VARCHAR(20),
  creado_en     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(empresa_id, slug)
);

-- 3. ASIGNACIONES (usuarios <-> proyectos, muchos a muchos)
CREATE TABLE IF NOT EXISTS asignaciones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id       UUID NOT NULL REFERENCES usuarios(id)  ON DELETE CASCADE,
  proyecto_id      UUID NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  rol_en_proyecto  VARCHAR(30) NOT NULL DEFAULT 'tecnico'
                     CHECK (rol_en_proyecto IN ('responsable','supervisor','tecnico')),
  asignado_en      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(usuario_id, proyecto_id)
);

-- 4. INFORMES (genérico, jerarquía Empresa → Proyecto → Informe)
-- tecnico_id / supervisor_id quedan NULL si el usuario se elimina (SET NULL),
-- así no se pierde el informe histórico.
CREATE TABLE IF NOT EXISTS informes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id     UUID NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  tecnico_id      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  supervisor_id   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  titulo          VARCHAR(255) NOT NULL,
  contenido       TEXT,
  estado          VARCHAR(30) NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador','enviado','aprobado','rechazado')),
  fecha_creacion  TIMESTAMPTZ DEFAULT NOW()
);

-- Índices de rendimiento
CREATE INDEX IF NOT EXISTS idx_perfiles_usuario      ON perfiles(usuario_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_perfiles_rut   ON perfiles(rut) WHERE rut IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proyectos_empresa     ON proyectos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_asign_usuario         ON asignaciones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_asign_proyecto        ON asignaciones(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_informes_proyecto     ON informes(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_informes_tecnico      ON informes(tecnico_id);
CREATE INDEX IF NOT EXISTS idx_informes_supervisor   ON informes(supervisor_id);

-- ================================================================
-- ROW LEVEL SECURITY — coherente con auth.sql
-- El backend usa service_role key (bypasea RLS). Se habilita por
-- consistencia; agregar políticas si se usa anon/user key.
-- ================================================================
ALTER TABLE perfiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE proyectos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE asignaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE informes     ENABLE ROW LEVEL SECURITY;
