const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'auth.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
`);

// Columnas extra para supervisores — agregadas de forma no destructiva
try { db.exec("ALTER TABLE usuarios ADD COLUMN empresa_nombre TEXT");         } catch {}
try { db.exec("ALTER TABLE usuarios ADD COLUMN jefe_id TEXT");                } catch {}
try { db.exec("ALTER TABLE usuarios ADD COLUMN tecnicos_ids TEXT DEFAULT '[]'"); } catch {}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const local = {
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
        INSERT INTO usuarios (id, empresa_id, nombre, email, password_hash, rol, activo)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(id, u.empresa_id || null, u.nombre, u.email, u.password_hash, u.rol);
      return db.prepare('SELECT id, nombre, email, rol, empresa_id FROM usuarios WHERE id = ?').get(id);
    },
    update(id, fields) {
      // Solo actualiza los campos permitidos
      const allowed = ['nombre', 'email', 'password_hash', 'empresa_nombre', 'jefe_id', 'tecnicos_ids'];
      const sets = Object.keys(fields).filter(k => allowed.includes(k));
      if (!sets.length) return;
      const sql = `UPDATE usuarios SET ${sets.map(k => `${k} = ?`).join(', ')} WHERE id = ?`;
      db.prepare(sql).run(...sets.map(k => fields[k]), id);
    },
    delete(id) {
      db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
    },
    list(empresa_id) {
      if (empresa_id) {
        return db.prepare(
          'SELECT id, nombre, email, rol, activo, empresa_nombre, jefe_id, tecnicos_ids FROM usuarios WHERE empresa_id = ?'
        ).all(empresa_id);
      }
      return db.prepare(
        'SELECT id, nombre, email, rol, activo, empresa_id, empresa_nombre, jefe_id, tecnicos_ids FROM usuarios'
      ).all();
    }
  },

  empresas: {
    insert(e) {
      const id = uuid();
      db.prepare('INSERT INTO empresas (id, nombre, slug) VALUES (?, ?, ?)').run(id, e.nombre, e.slug);
      return db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
    },
    list() {
      return db.prepare('SELECT * FROM empresas WHERE activa = 1').all();
    },
    findBySlug(slug) {
      return db.prepare('SELECT * FROM empresas WHERE slug = ?').get(slug);
    }
  },

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
  }
};

module.exports = local;
