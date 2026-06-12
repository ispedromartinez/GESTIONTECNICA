const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');
const { requireRol } = require('../middleware/roles');

const router = express.Router();

let supabaseClient = null;
try {
  if (
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_KEY &&
    process.env.USE_LOCAL_DB !== 'true'
  ) {
    const { createClient } = require('@supabase/supabase-js');
    supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    console.log('🗄️  Auth: usando Supabase');
  } else {
    console.log('🗄️  Auth: usando SQLite local (auth.db)');
  }
} catch {}

const localDB = require('../db/local');

const db = {
  async findUserByEmail(email) {
    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('usuarios')
        .select('id,nombre,email,password_hash,rol,empresa_id,activo')
        .eq('email', email)
        .single();
      if (!error) return data;
    }
    return localDB.usuarios.findByEmail(email) || null;
  },

  async findEmpresaBySlug(slug) {
    if (supabaseClient) {
      const { data } = await supabaseClient
        .from('empresas').select('id,nombre,slug').eq('slug', slug).eq('activa', true).single();
      return data || null;
    }
    return localDB.empresas.findBySlug(slug) || null;
  },

  async getAreasByUser(usuario_id) {
    if (supabaseClient) {
      const { data } = await supabaseClient
        .from('usuario_areas').select('area_id').eq('usuario_id', usuario_id);
      return (data || []).map(r => r.area_id);
    }
    return localDB.usuario_areas.getByUsuario(usuario_id).map(r => r.area_id);
  },

  async insertUsuario(u) {
    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('usuarios')
        .insert(u)
        .select('id,nombre,email,rol,empresa_id')
        .single();
      if (error) throw new Error(error.message);
      return data;
    }
    return localDB.usuarios.insert(u);
  },

  async insertEmpresa(e) {
    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('empresas').insert(e).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    return localDB.empresas.insert(e);
  },

  async getAreaById(id) {
    if (supabaseClient) {
      const { data } = await supabaseClient.from('areas').select('empresa_id').eq('id', id).single();
      return data;
    }
    return localDB.areas.findById(id);
  },

  async upsertUsuarioArea(usuario_id, area_id, asignado_por) {
    if (supabaseClient) {
      const { error } = await supabaseClient
        .from('usuario_areas')
        .upsert({ usuario_id, area_id, asignado_por });
      if (error) throw new Error(error.message);
      return;
    }
    localDB.usuario_areas.upsert(usuario_id, area_id, asignado_por);
  },

  async listEmpresas() {
    if (supabaseClient) {
      const { data } = await supabaseClient.from('empresas').select('*').eq('activa', true);
      return data || [];
    }
    return localDB.empresas.list();
  },

  async listUsuarios(empresa_id) {
    if (supabaseClient) {
      let q = supabaseClient.from('usuarios').select('id,nombre,email,rol,activo,empresa_id,empresa_nombre,jefe_id,tecnicos_ids');
      if (empresa_id) q = q.eq('empresa_id', empresa_id);
      const { data } = await q;
      return data || [];
    }
    return localDB.usuarios.list(empresa_id);
  },

  async findUsuarioById(id) {
    if (supabaseClient) {
      const { data } = await supabaseClient
        .from('usuarios')
        .select('id,nombre,email,rol,activo,empresa_id,empresa_nombre,jefe_id,tecnicos_ids')
        .eq('id', id).single();
      return data || null;
    }
    return localDB.usuarios.findById(id) || null;
  },

  async updateUsuario(id, fields) {
    if (supabaseClient) {
      const { error } = await supabaseClient.from('usuarios').update(fields).eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }
    localDB.usuarios.update(id, fields);
  },

  async listAreasByEmpresa(empresa_id) {
    if (supabaseClient) {
      const { data } = await supabaseClient.from('areas').select('*').eq('empresa_id', empresa_id).eq('activa', true);
      return data || [];
    }
    return localDB.areas.listByEmpresa(empresa_id);
  },

  async insertArea(a) {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from('areas').insert(a).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    return localDB.areas.insert(a);
  },

  async deleteUsuario(id) {
    if (supabaseClient) {
      const { error } = await supabaseClient.from('usuarios').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }
    localDB.usuarios.delete(id);
  }
};

router.post('/login', async (req, res) => {
  try {
    const { email, password, empresa: empresaSlug } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email y contraseña requeridos' });

    const usuario = await db.findUserByEmail(email.toLowerCase().trim());
    // Mismo mensaje para email no encontrado y contraseña incorrecta — evita enumeración
    if (!usuario) return res.status(401).json({ error: 'Credenciales inválidas' });
    if (!usuario.activo) return res.status(403).json({ error: 'Cuenta desactivada' });

    const ok = await bcrypt.compare(password, usuario.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    // superadmin no tiene empresa asignada → se omite la validación
    if (empresaSlug && usuario.rol !== 'superadmin') {
      const empresa = await db.findEmpresaBySlug(empresaSlug.toLowerCase().trim());
      if (!empresa) {
        return res.status(401).json({ error: 'Empresa no encontrada o inactiva' });
      }
      if (empresa.id !== usuario.empresa_id) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }
    }

    let areas_permitidas = [];
    if (usuario.rol === 'supervisor' || usuario.rol === 'tecnico') {
      areas_permitidas = await db.getAreasByUser(usuario.id);
    }

    const payload = {
      usuario_id:      usuario.id,
      nombre:          usuario.nombre,
      email:           usuario.email,
      rol:             usuario.rol,
      empresa_id:      usuario.empresa_id || null,
      areas_permitidas
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, usuario: payload });
  } catch (err) {
    console.error('/auth/login:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/dev-token', async (req, res) => {
  if (process.env.DEV_AUTO_LOGIN !== 'true')
    return res.status(403).json({ error: 'No disponible' });

  const email = process.env.DEV_AUTO_EMAIL || '';
  const usuario = await db.findUserByEmail(email.toLowerCase().trim());
  if (!usuario) return res.status(404).json({ error: 'Usuario dev no encontrado' });

  const payload = {
    usuario_id:      usuario.id,
    nombre:          usuario.nombre,
    email:           usuario.email,
    rol:             usuario.rol,
    empresa_id:      usuario.empresa_id || null,
    areas_permitidas: []
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, usuario: payload });
});

router.post('/register-superadmin', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production')
      return res.status(403).json({ error: 'No disponible en producción' });

    const { nombre, email, password, secret } = req.body;
    if (!secret || secret !== process.env.ADMIN_SECRET)
      return res.status(403).json({ error: 'Secret incorrecto' });

    const password_hash = await bcrypt.hash(password, 12);
    const usuario = await db.insertUsuario({
      nombre,
      email: email.toLowerCase().trim(),
      password_hash,
      rol: 'superadmin',
      activo: true
    });
    res.json({ ok: true, usuario });
  } catch (err) {
    console.error('/auth/register-superadmin:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/crear-empresa', authMiddleware, requireRol('superadmin'), async (req, res) => {
  try {
    const { nombre, slug } = req.body;
    if (!nombre || !slug)
      return res.status(400).json({ error: 'nombre y slug requeridos' });

    const empresa = await db.insertEmpresa({ nombre, slug: slug.toLowerCase() });
    res.json({ ok: true, empresa });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/crear-usuario', authMiddleware, async (req, res) => {
  try {
    const { rol: rolCreador, empresa_id: empresaCreador } = req.user;
    const { nombre, email, password, rol, empresa_id } = req.body;

    if (!nombre || !email || !password || !rol)
      return res.status(400).json({ error: 'nombre, email, password y rol son requeridos' });

    if (rolCreador === 'superadmin') {
      if (!['superadmin','admin_empresa','supervisor','tecnico'].includes(rol))
        return res.status(400).json({ error: 'Rol inválido' });
    } else if (rolCreador === 'admin_empresa') {
      if (!['supervisor','tecnico'].includes(rol))
        return res.status(403).json({ error: 'Solo puedes crear supervisores y técnicos' });
      if (empresa_id && empresa_id !== empresaCreador)
        return res.status(403).json({ error: 'Solo puedes crear usuarios en tu empresa' });
    } else if (rolCreador === 'supervisor') {
      if (rol !== 'tecnico')
        return res.status(403).json({ error: 'Los supervisores solo pueden crear técnicos' });
      if (empresa_id && empresa_id !== empresaCreador)
        return res.status(403).json({ error: 'Solo puedes crear usuarios en tu empresa' });
    } else {
      return res.status(403).json({ error: 'Sin permisos para crear usuarios' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const usuario = await db.insertUsuario({
      nombre,
      email: email.toLowerCase().trim(),
      password_hash,
      rol,
      empresa_id: rol === 'superadmin' ? null : (empresa_id || empresaCreador),
      activo: true
    });
    res.json({ ok: true, usuario });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/crear-area', authMiddleware, requireRol('superadmin', 'admin_empresa'), async (req, res) => {
  try {
    const { nombre, empresa_id } = req.body;
    const empId = req.user.rol === 'superadmin' ? empresa_id : req.user.empresa_id;
    if (!nombre || !empId)
      return res.status(400).json({ error: 'nombre y empresa_id requeridos' });

    const area = await db.insertArea({ empresa_id: empId, nombre });
    res.json({ ok: true, area });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/asignar-area', authMiddleware, requireRol('superadmin', 'admin_empresa'), async (req, res) => {
  try {
    const { usuario_id, area_id } = req.body;
    if (!usuario_id || !area_id)
      return res.status(400).json({ error: 'usuario_id y area_id requeridos' });

    if (req.user.rol === 'admin_empresa') {
      const area = await db.getAreaById(area_id);
      if (!area || area.empresa_id !== req.user.empresa_id)
        return res.status(403).json({ error: 'Área no pertenece a tu empresa' });
    }

    await db.upsertUsuarioArea(usuario_id, area_id, req.user.usuario_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/empresas', authMiddleware, requireRol('superadmin'), async (req, res) => {
  try {
    res.json(await db.listEmpresas());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/usuarios', authMiddleware, async (req, res) => {
  try {
    const { rol, empresa_id } = req.user;
    const filtro = rol === 'superadmin' ? null : empresa_id;
    res.json(await db.listUsuarios(filtro));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/areas', authMiddleware, async (req, res) => {
  try {
    const { rol, empresa_id } = req.user;
    if (!empresa_id && rol !== 'superadmin')
      return res.status(400).json({ error: 'empresa_id requerido' });
    const empId = req.query.empresa_id || empresa_id;
    res.json(await db.listAreasByEmpresa(empId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/personal', authMiddleware, async (req, res) => {
  try {
    const { rol, empresa_id } = req.user;
    const filtro = rol === 'superadmin' ? null : empresa_id;
    const todos = await db.listUsuarios(filtro);
    const personal = todos.filter(u => ['supervisor','tecnico'].includes(u.rol) && u.activo);
    res.json(personal.map(u => ({
      id: u.id, nombre: u.nombre, email: u.email, rol: u.rol,
      empresa_nombre: u.empresa_nombre || '',
      jefe_id: u.jefe_id || null,
      tecnicos_ids: (() => { try { return JSON.parse(u.tecnicos_ids || '[]'); } catch { return []; } })()
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/usuarios/:id', authMiddleware, requireRol('superadmin'), async (req, res) => {
  try {
    const u = await db.findUsuarioById(req.params.id);
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({
      id: u.id, nombre: u.nombre, email: u.email, rol: u.rol,
      empresa_nombre: u.empresa_nombre || '',
      jefe_id: u.jefe_id || null,
      tecnicos_ids: (() => { try { return JSON.parse(u.tecnicos_ids || '[]'); } catch { return []; } })()
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/usuarios/:id', authMiddleware, requireRol('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user.usuario_id)
      return res.status(400).json({ error: 'No puedes editarte a ti mismo desde aquí' });

    const { nombre, email, password, empresa_nombre, jefe_id, tecnicos_ids } = req.body;
    const fields = {};
    if (nombre)          fields.nombre          = nombre.trim();
    if (email)           fields.email           = email.toLowerCase().trim();
    if (empresa_nombre !== undefined) fields.empresa_nombre = empresa_nombre;
    if (jefe_id    !== undefined) fields.jefe_id    = jefe_id || null;
    if (tecnicos_ids !== undefined) fields.tecnicos_ids = JSON.stringify(tecnicos_ids || []);
    if (password && password.length >= 6) {
      const bcrypt = require('bcryptjs');
      fields.password_hash = await bcrypt.hash(password, 12);
    }
    if (!Object.keys(fields).length)
      return res.status(400).json({ error: 'Sin campos para actualizar' });

    await db.updateUsuario(id, fields);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/usuarios/:id', authMiddleware, requireRol('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user.usuario_id)
      return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    await db.deleteUsuario(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ usuario: req.user });
});

module.exports = router;
