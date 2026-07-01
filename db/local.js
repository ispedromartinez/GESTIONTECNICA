const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'auth.db');
const db = new Database(DB_PATH);

// Habilitar foreign keys y WAL para mejor rendimiento
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Crear tablas si no existen ────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS empresas (
    id        TEXT PRIMARY KEY,
    nombre    TEXT NOT NULL,
    slug      TEXT UNIQUE NOT NULL,
    activa    INTEGER DEFAULT 1,
    creado_en TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id            TEXT PRIMARY KEY,
    empresa_id    TEXT REFERENCES empresas(id) ON DELETE CASCADE,
    nombre        TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    rol           TEXT NOT NULL CHECK(rol IN ('superadmin','admin_empresa','supervisor','tecnico')),
    activo        INTEGER DEFAULT 1,
    creado_en     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS areas (
    id         TEXT PRIMARY KEY,
    empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nombre     TEXT NOT NULL,
    activa     INTEGER DEFAULT 1,
    creado_en  TEXT DEFAULT (datetime('now')),
    UNIQUE(empresa_id, nombre)
  );

  CREATE TABLE IF NOT EXISTS usuario_areas (
    usuario_id   TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    area_id      TEXT NOT NULL REFERENCES areas(id)    ON DELETE CASCADE,
    asignado_por TEXT REFERENCES usuarios(id),
    asignado_en  TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (usuario_id, area_id)
  );

  -- Perfil 1:1 con usuario (usuario_id UNIQUE)
  CREATE TABLE IF NOT EXISTS perfiles (
    id          TEXT PRIMARY KEY,
    usuario_id  TEXT NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
    rut         TEXT UNIQUE,
    nombre      TEXT,
    apellidos   TEXT,
    telefono    TEXT,
    cargo       TEXT,
    creado_en   TEXT DEFAULT (datetime('now'))
  );

  -- Proyectos (reemplaza proyectos.json)
  CREATE TABLE IF NOT EXISTS proyectos (
    id            TEXT PRIMARY KEY,
    empresa_id    TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nombre        TEXT NOT NULL,
    slug          TEXT,
    estado        TEXT NOT NULL DEFAULT 'activo'
                    CHECK(estado IN ('planificado','activo','pausado','finalizado','cancelado')),
    fecha_inicio  TEXT,
    logo          TEXT,
    template      TEXT,
    color         TEXT,
    creado_en     TEXT DEFAULT (datetime('now')),
    UNIQUE(empresa_id, slug)
  );

  -- Asignaciones usuario <-> proyecto (muchos a muchos)
  CREATE TABLE IF NOT EXISTS asignaciones (
    id               TEXT PRIMARY KEY,
    usuario_id       TEXT NOT NULL REFERENCES usuarios(id)  ON DELETE CASCADE,
    proyecto_id      TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
    rol_en_proyecto  TEXT NOT NULL DEFAULT 'tecnico'
                       CHECK(rol_en_proyecto IN ('responsable','supervisor','tecnico')),
    asignado_en      TEXT DEFAULT (datetime('now')),
    UNIQUE(usuario_id, proyecto_id)
  );

  -- Informes (genérico): Empresa -> Proyecto -> Informe
  CREATE TABLE IF NOT EXISTS informes (
    id              TEXT PRIMARY KEY,
    proyecto_id     TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
    tecnico_id      TEXT REFERENCES usuarios(id) ON DELETE SET NULL,
    supervisor_id   TEXT REFERENCES usuarios(id) ON DELETE SET NULL,
    titulo          TEXT NOT NULL,
    contenido       TEXT,
    estado          TEXT NOT NULL DEFAULT 'borrador'
                      CHECK(estado IN ('borrador','enviado','aprobado','rechazado')),
    fecha_creacion  TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_proyectos_empresa   ON proyectos(empresa_id);
  CREATE INDEX IF NOT EXISTS idx_asign_usuario       ON asignaciones(usuario_id);
  CREATE INDEX IF NOT EXISTS idx_asign_proyecto      ON asignaciones(proyecto_id);
  CREATE INDEX IF NOT EXISTS idx_informes_proyecto   ON informes(proyecto_id);
  CREATE INDEX IF NOT EXISTS idx_informes_tecnico    ON informes(tecnico_id);
`);

// ── Migraciones idempotentes (ADD COLUMN lanza error si ya existe) ──
try { db.exec("ALTER TABLE empresas ADD COLUMN rut_empresa TEXT"); } catch {}
// Datos comerciales de la empresa (opcionales)
try { db.exec("ALTER TABLE empresas ADD COLUMN nombre_fantasia TEXT"); } catch {}
try { db.exec("ALTER TABLE empresas ADD COLUMN contacto TEXT"); } catch {}
try { db.exec("ALTER TABLE empresas ADD COLUMN correo TEXT"); } catch {}
try { db.exec("ALTER TABLE empresas ADD COLUMN direccion TEXT"); } catch {}
// Vínculo técnico → supervisor (carga masiva de usuarios)
try { db.exec("ALTER TABLE usuarios ADD COLUMN supervisor_id TEXT"); } catch {}
// Rama del proyecto: 'correctivo' | 'preventivo' (los informes heredan la rama de su proyecto)
try { db.exec("ALTER TABLE proyectos ADD COLUMN tipo TEXT"); } catch {}
// Categoría del proyecto: 'clima' | 'energia' | 'obras_civiles'
try { db.exec("ALTER TABLE proyectos ADD COLUMN categoria TEXT"); } catch {}
// Ocultar el proyecto de la vista de supervisores/técnicos (0/1)
try { db.exec("ALTER TABLE proyectos ADD COLUMN oculto INTEGER DEFAULT 0"); } catch {}
// Sitio al que va asignada la actividad y su LPU
try { db.exec("ALTER TABLE informes ADD COLUMN sitio TEXT"); } catch {}
try { db.exec("ALTER TABLE informes ADD COLUMN lpu TEXT"); } catch {}
// Documento generado (Word .docx): enlace de descarga y nombre de archivo.
// Se rellena cuando el técnico realmente genera el documento desde el formulario.
try { db.exec("ALTER TABLE informes ADD COLUMN doc_url TEXT"); } catch {}
try { db.exec("ALTER TABLE informes ADD COLUMN doc_nombre TEXT"); } catch {}
// Marca de la última actualización del informe (cambio de estado / documento generado).
try { db.exec("ALTER TABLE informes ADD COLUMN actualizado_en TEXT"); } catch {}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── API compatible con los mismos datos que Supabase devuelve ─

const local = {
  // Usuarios
  usuarios: {
    findByEmail(email) {
      return db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    },
    findById(id) {
      return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    },
    insert(u) {
      const id = uuid();
      db.prepare(`
        INSERT INTO usuarios (id, empresa_id, nombre, email, password_hash, rol, supervisor_id, activo)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `).run(id, u.empresa_id || null, u.nombre, u.email, u.password_hash, u.rol, u.supervisor_id || null);
      return db.prepare('SELECT id, nombre, email, rol, empresa_id, supervisor_id FROM usuarios WHERE id = ?').get(id);
    },
    delete(id) {
      db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
    },
    // Actualiza solo los campos provistos (nombre,email,rol,empresa_id,password_hash)
    update(id, f) {
      const cols = ['nombre','email','rol','empresa_id','password_hash'];
      const sets = [], vals = [];
      cols.forEach(k => { if (f[k] !== undefined) { sets.push(k+' = ?'); vals.push(f[k]); } });
      if (sets.length) { vals.push(id); db.prepare('UPDATE usuarios SET '+sets.join(', ')+' WHERE id = ?').run(...vals); }
      return db.prepare('SELECT id, nombre, email, rol, empresa_id, activo FROM usuarios WHERE id = ?').get(id);
    },
    list(empresa_id) {
      if (empresa_id) {
        return db.prepare('SELECT id, nombre, email, rol, activo, empresa_id FROM usuarios WHERE empresa_id = ?').all(empresa_id);
      }
      return db.prepare('SELECT id, nombre, email, rol, activo, empresa_id FROM usuarios').all();
    },
    // Lista enriquecida con RUT (perfil) y nombre de empresa — para el panel admin
    listDetalle(empresa_id) {
      const base = `SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.empresa_id,
                           p.rut, e.nombre AS empresa_nombre, e.rut_empresa AS empresa_rut
                    FROM usuarios u
                    LEFT JOIN perfiles p ON p.usuario_id = u.id
                    LEFT JOIN empresas e ON e.id = u.empresa_id`;
      if (empresa_id) return db.prepare(base + ' WHERE u.empresa_id = ?').all(empresa_id);
      return db.prepare(base).all();
    }
  },

  // Empresas
  empresas: {
    insert(e) {
      const id = uuid();
      db.prepare('INSERT INTO empresas (id, nombre, slug, rut_empresa, nombre_fantasia, contacto, correo, direccion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, e.nombre, e.slug, e.rut_empresa || null,
             e.nombre_fantasia || null, e.contacto || null, e.correo || null, e.direccion || null);
      return db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
    },
    // Actualiza solo los campos provistos
    update(id, f) {
      const cols = ['nombre','slug','rut_empresa','activa','nombre_fantasia','contacto','correo','direccion'];
      const sets = [], vals = [];
      cols.forEach(k => { if (f[k] !== undefined) { sets.push(k+' = ?'); vals.push(f[k]); } });
      if (sets.length) { vals.push(id); db.prepare('UPDATE empresas SET '+sets.join(', ')+' WHERE id = ?').run(...vals); }
      return db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
    },
    list() {
      return db.prepare('SELECT * FROM empresas WHERE activa = 1').all();
    },
    // Todas (incluye inactivas) — para la gestión de clientes
    listAll() {
      return db.prepare('SELECT * FROM empresas ORDER BY creado_en DESC').all();
    },
    findBySlug(slug) {
      return db.prepare('SELECT * FROM empresas WHERE slug = ?').get(slug);
    },
    findById(id) {
      return db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
    }
  },

  // Areas
  areas: {
    insert(a) {
      const id = uuid();
      db.prepare('INSERT INTO areas (id, empresa_id, nombre) VALUES (?, ?, ?)').run(id, a.empresa_id, a.nombre);
      return db.prepare('SELECT * FROM areas WHERE id = ?').get(id);
    },
    listByEmpresa(empresa_id) {
      return db.prepare('SELECT * FROM areas WHERE empresa_id = ? AND activa = 1').all(empresa_id);
    },
    findById(id) {
      return db.prepare('SELECT * FROM areas WHERE id = ?').get(id);
    }
  },

  // Usuario_areas
  usuario_areas: {
    getByUsuario(usuario_id) {
      return db.prepare('SELECT area_id FROM usuario_areas WHERE usuario_id = ?').all(usuario_id);
    },
    upsert(usuario_id, area_id, asignado_por) {
      db.prepare(`
        INSERT OR REPLACE INTO usuario_areas (usuario_id, area_id, asignado_por)
        VALUES (?, ?, ?)
      `).run(usuario_id, area_id, asignado_por || null);
    }
  },

  // Perfiles (1:1 con usuario)
  perfiles: {
    findByUsuario(usuario_id) {
      return db.prepare('SELECT * FROM perfiles WHERE usuario_id = ?').get(usuario_id);
    },
    // Regla 4: el RUT es único. Excluye al propio usuario al editar.
    findByRut(rut, exclude_usuario_id) {
      if (exclude_usuario_id) {
        return db.prepare('SELECT * FROM perfiles WHERE rut = ? AND usuario_id != ?')
          .get(rut, exclude_usuario_id);
      }
      return db.prepare('SELECT * FROM perfiles WHERE rut = ?').get(rut);
    },
    // Crea o actualiza el perfil del usuario (1:1)
    upsert(p) {
      const existing = db.prepare('SELECT id FROM perfiles WHERE usuario_id = ?').get(p.usuario_id);
      if (existing) {
        db.prepare(`
          UPDATE perfiles SET rut = ?, nombre = ?, apellidos = ?, telefono = ?, cargo = ?
          WHERE usuario_id = ?
        `).run(p.rut || null, p.nombre || null, p.apellidos || null,
               p.telefono || null, p.cargo || null, p.usuario_id);
        return db.prepare('SELECT * FROM perfiles WHERE usuario_id = ?').get(p.usuario_id);
      }
      const id = uuid();
      db.prepare(`
        INSERT INTO perfiles (id, usuario_id, rut, nombre, apellidos, telefono, cargo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, p.usuario_id, p.rut || null, p.nombre || null,
             p.apellidos || null, p.telefono || null, p.cargo || null);
      return db.prepare('SELECT * FROM perfiles WHERE id = ?').get(id);
    }
  },

  // Proyectos
  proyectos: {
    insert(p) {
      const id = uuid();
      db.prepare(`
        INSERT INTO proyectos (id, empresa_id, nombre, slug, estado, fecha_inicio, logo, template, color, tipo, categoria)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, p.empresa_id, p.nombre, p.slug || null, p.estado || 'activo',
             p.fecha_inicio || null, p.logo || null, p.template || null, p.color || null,
             p.tipo || null, p.categoria || null);
      return db.prepare('SELECT * FROM proyectos WHERE id = ?').get(id);
    },
    findById(id) {
      return db.prepare('SELECT * FROM proyectos WHERE id = ?').get(id);
    },
    findBySlug(empresa_id, slug) {
      return db.prepare('SELECT * FROM proyectos WHERE empresa_id = ? AND slug = ?').get(empresa_id, slug);
    },
    listByEmpresa(empresa_id) {
      return db.prepare('SELECT * FROM proyectos WHERE empresa_id = ? ORDER BY creado_en DESC').all(empresa_id);
    },
    // Todos los proyectos (solo superadmin) con nombre de empresa
    all() {
      return db.prepare(`
        SELECT p.*, e.nombre AS empresa_nombre
        FROM proyectos p JOIN empresas e ON e.id = p.empresa_id
        ORDER BY p.creado_en DESC
      `).all();
    },
    updateEstado(id, estado) {
      db.prepare('UPDATE proyectos SET estado = ? WHERE id = ?').run(estado, id);
    },
    // Actualiza solo los campos provistos
    update(id, f) {
      const cols = ['empresa_id','nombre','slug','estado','fecha_inicio','logo','template','color','tipo','categoria','oculto'];
      const sets = [], vals = [];
      cols.forEach(k => { if (f[k] !== undefined) { sets.push(k+' = ?'); vals.push(f[k]); } });
      if (sets.length) { vals.push(id); db.prepare('UPDATE proyectos SET '+sets.join(', ')+' WHERE id = ?').run(...vals); }
      return db.prepare('SELECT * FROM proyectos WHERE id = ?').get(id);
    },
    delete(id) {
      db.prepare('DELETE FROM proyectos WHERE id = ?').run(id);
    }
  },

  // Asignaciones (usuario <-> proyecto)
  asignaciones: {
    upsert(usuario_id, proyecto_id, rol_en_proyecto) {
      const existing = db.prepare(
        'SELECT id FROM asignaciones WHERE usuario_id = ? AND proyecto_id = ?'
      ).get(usuario_id, proyecto_id);
      if (existing) {
        db.prepare('UPDATE asignaciones SET rol_en_proyecto = ? WHERE id = ?')
          .run(rol_en_proyecto || 'tecnico', existing.id);
        return db.prepare('SELECT * FROM asignaciones WHERE id = ?').get(existing.id);
      }
      const id = uuid();
      db.prepare(`
        INSERT INTO asignaciones (id, usuario_id, proyecto_id, rol_en_proyecto)
        VALUES (?, ?, ?, ?)
      `).run(id, usuario_id, proyecto_id, rol_en_proyecto || 'tecnico');
      return db.prepare('SELECT * FROM asignaciones WHERE id = ?').get(id);
    },
    listByProyecto(proyecto_id) {
      return db.prepare(`
        SELECT a.*, u.nombre, u.email, u.rol, u.empresa_id
        FROM asignaciones a JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.proyecto_id = ?
      `).all(proyecto_id);
    },
    // ¿Existe ya esta asignación? (para validar antes de crear informe)
    exists(usuario_id, proyecto_id) {
      return !!db.prepare('SELECT 1 FROM asignaciones WHERE usuario_id = ? AND proyecto_id = ?')
        .get(usuario_id, proyecto_id);
    },
    // Regla 2: técnicos/supervisores activos asignados al proyecto
    // Y que pertenezcan a la empresa del proyecto.
    personalDeProyecto(proyecto_id, empresa_id) {
      return db.prepare(`
        SELECT u.id, u.nombre, u.rol, a.rol_en_proyecto
        FROM asignaciones a JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.proyecto_id = ? AND u.empresa_id = ? AND u.activo = 1
          AND u.rol IN ('supervisor','tecnico')
      `).all(proyecto_id, empresa_id);
    },
    listByUsuario(usuario_id) {
      // Los proyectos ocultos no se muestran a supervisores/técnicos.
      return db.prepare(`
        SELECT a.*, p.nombre AS proyecto_nombre, p.slug, p.estado, p.color, p.logo, p.template, p.tipo
        FROM asignaciones a JOIN proyectos p ON p.id = a.proyecto_id
        WHERE a.usuario_id = ? AND COALESCE(p.oculto, 0) = 0
      `).all(usuario_id);
    },
    // Todas las asignaciones de una empresa (mapa usuario↔proyecto del panel).
    listPorEmpresa(empresa_id) {
      const base = `
        SELECT a.usuario_id, a.proyecto_id, a.rol_en_proyecto,
               p.nombre AS proyecto_nombre, p.tipo AS proyecto_tipo
        FROM asignaciones a JOIN proyectos p ON p.id = a.proyecto_id`;
      return empresa_id
        ? db.prepare(base + ' WHERE p.empresa_id = ?').all(empresa_id)
        : db.prepare(base).all();
    },
    remove(usuario_id, proyecto_id) {
      db.prepare('DELETE FROM asignaciones WHERE usuario_id = ? AND proyecto_id = ?')
        .run(usuario_id, proyecto_id);
    }
  },

  // Informes (genérico)
  informes: {
    insert(i) {
      const id = uuid();
      db.prepare(`
        INSERT INTO informes (id, proyecto_id, tecnico_id, supervisor_id, titulo, contenido, estado, sitio, lpu, actualizado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(id, i.proyecto_id, i.tecnico_id || null, i.supervisor_id || null,
             i.titulo, i.contenido || null, i.estado || 'borrador',
             i.sitio || null, i.lpu || null);
      return db.prepare('SELECT * FROM informes WHERE id = ?').get(id);
    },
    findById(id) {
      return db.prepare('SELECT * FROM informes WHERE id = ?').get(id);
    },
    listByProyecto(proyecto_id) {
      return db.prepare('SELECT * FROM informes WHERE proyecto_id = ? ORDER BY fecha_creacion DESC').all(proyecto_id);
    },
    listByTecnico(tecnico_id) {
      return db.prepare('SELECT * FROM informes WHERE tecnico_id = ? ORDER BY fecha_creacion DESC').all(tecnico_id);
    },
    // Informes donde el usuario es técnico O supervisor (para "Mis informes")
    listByUsuario(usuario_id) {
      return db.prepare(`
        SELECT i.*, p.nombre AS proyecto_nombre, p.tipo AS proyecto_tipo,
               p.slug AS proyecto_slug, p.template AS proyecto_template, p.color AS proyecto_color
        FROM informes i JOIN proyectos p ON p.id = i.proyecto_id
        WHERE i.tecnico_id = ? OR i.supervisor_id = ?
        ORDER BY i.fecha_creacion DESC
      `).all(usuario_id, usuario_id);
    },
    // Informes recientes; opcionalmente acotados a una empresa
    recientes(limit = 5, empresa_id = null) {
      if (empresa_id) {
        return db.prepare(`
          SELECT i.*, p.nombre AS proyecto_nombre, p.tipo AS proyecto_tipo
          FROM informes i JOIN proyectos p ON p.id = i.proyecto_id
          WHERE p.empresa_id = ?
          ORDER BY i.fecha_creacion DESC LIMIT ?
        `).all(empresa_id, limit);
      }
      return db.prepare(`
        SELECT i.*, p.nombre AS proyecto_nombre, p.tipo AS proyecto_tipo
        FROM informes i JOIN proyectos p ON p.id = i.proyecto_id
        ORDER BY i.fecha_creacion DESC LIMIT ?
      `).all(limit);
    },
    // Listado liviano de todos los informes para estadísticas del dashboard.
    paraStats(empresa_id = null) {
      const base = `SELECT i.estado, i.fecha_creacion, i.sitio,
                      p.nombre AS proyecto_nombre, p.tipo AS proyecto_tipo
                    FROM informes i JOIN proyectos p ON p.id = i.proyecto_id`;
      if (empresa_id) return db.prepare(base + ' WHERE p.empresa_id = ?').all(empresa_id);
      return db.prepare(base).all();
    },
    updateEstado(id, estado) {
      db.prepare("UPDATE informes SET estado = ?, actualizado_en = datetime('now') WHERE id = ?").run(estado, id);
    },
    // El documento real fue generado: pasa a 'enviado' y guarda el enlace.
    setDocumento(id, doc_url, doc_nombre) {
      db.prepare("UPDATE informes SET estado = 'enviado', doc_url = ?, doc_nombre = ?, actualizado_en = datetime('now') WHERE id = ?")
        .run(doc_url, doc_nombre, id);
    },
    delete(id) {
      db.prepare('DELETE FROM informes WHERE id = ?').run(id);
    }
  }
};

module.exports = local;
