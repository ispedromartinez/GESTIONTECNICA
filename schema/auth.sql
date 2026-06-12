-- ================================================================
-- SCHEMA DE AUTENTICACIÓN Y MULTI-TENANCY
-- Ejecutar en Supabase SQL Editor
-- ================================================================

-- 1. EMPRESAS (tenants)
CREATE TABLE IF NOT EXISTS empresas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     VARCHAR(255) NOT NULL,
  slug       VARCHAR(100) UNIQUE NOT NULL,
  activa     BOOLEAN DEFAULT true,
  creado_en  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. USUARIOS
-- empresa_id es NULL para superadmin (opera a nivel plataforma)
CREATE TABLE IF NOT EXISTS usuarios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID REFERENCES empresas(id) ON DELETE CASCADE,
  nombre         VARCHAR(255) NOT NULL,
  email          VARCHAR(255) UNIQUE NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  rol            VARCHAR(50)  NOT NULL
                   CHECK (rol IN ('superadmin','admin_empresa','supervisor','tecnico')),
  activo         BOOLEAN DEFAULT true,
  creado_en      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. AREAS (pertenecen a una empresa)
CREATE TABLE IF NOT EXISTS areas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre      VARCHAR(255) NOT NULL,
  activa      BOOLEAN DEFAULT true,
  creado_en   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(empresa_id, nombre)
);

-- 4. USUARIO_AREAS (qué áreas puede ver cada supervisor/técnico)
CREATE TABLE IF NOT EXISTS usuario_areas (
  usuario_id   UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  area_id      UUID NOT NULL REFERENCES areas(id)    ON DELETE CASCADE,
  asignado_por UUID REFERENCES usuarios(id),
  asignado_en  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (usuario_id, area_id)
);

-- Índices de rendimiento
CREATE INDEX IF NOT EXISTS idx_usuarios_empresa    ON usuarios(empresa_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_email      ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_areas_empresa       ON areas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_uareas_usuario      ON usuario_areas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_uareas_area         ON usuario_areas(area_id);

-- ================================================================
-- ROW LEVEL SECURITY (RLS) — aislamiento total por empresa
-- ================================================================

ALTER TABLE empresas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE areas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_areas ENABLE ROW LEVEL SECURITY;

-- El backend usa la service_role key que bypasea RLS.
-- Si en algún momento usas anon/user keys desde el cliente,
-- agrega políticas aquí. Por ahora el backend es la única puerta.

-- ================================================================
-- DATOS INICIALES DE EJEMPLO
-- ================================================================

-- Empresa de prueba
-- INSERT INTO empresas (nombre, slug) VALUES ('ICETEL', 'icetel');

-- Superadmin (password: 'admin123' — cámbialo en producción)
-- El hash se genera con: node -e "require('bcryptjs').hash('admin123',12).then(console.log)"
-- INSERT INTO usuarios (nombre, email, password_hash, rol)
-- VALUES ('Admin Master', 'admin@icetel.cl', '<hash>', 'superadmin');
