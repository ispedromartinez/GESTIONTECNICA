const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');
const { requireRol } = require('../middleware/roles');
const { canAccessTenant } = require('../middleware/tenant');
const { validarRut, normalizarRut } = require('../utils/rut');
const gestionDB = require('../db/gestion');
const audit = require('../db/auditoria');

const router = express.Router();

// ── Fuente de datos: Supabase si está disponible y USE_LOCAL_DB != true ──
const { supabase: supabaseClient } = require('../db/supabase');
console.log(supabaseClient ? '🗄️  Auth: usando Supabase' : '🗄️  Auth: usando SQLite local (auth.db)');

const localDB = require('../db/local');

// Abstracción: mismas funciones, distinta fuente
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

  async findUserById(id) {
    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('usuarios')
        .select('id,nombre,email,password_hash,rol,empresa_id,activo')
        .eq('id', id)
        .single();
      if (!error) return data;
    }
    return localDB.usuarios.findById(id) || null;
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
      let q = supabaseClient.from('usuarios')
        .select('id,nombre,email,rol,activo,empresa_id,perfiles(rut),empresas(nombre,rut_empresa)');
      if (empresa_id) q = q.eq('empresa_id', empresa_id);
      const { data } = await q;
      return (data || []).map(u => ({
        id:u.id, nombre:u.nombre, email:u.email, rol:u.rol, activo:u.activo, empresa_id:u.empresa_id,
        rut: u.perfiles?.rut || null, empresa_nombre: u.empresas?.nombre || null,
        empresa_rut: u.empresas?.rut_empresa || null
      }));
    }
    return localDB.usuarios.listDetalle(empresa_id);
  },

  async updateUsuario(id, fields) {
    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('usuarios').update(fields).eq('id', id)
        .select('id,nombre,email,rol,empresa_id,activo').single();
      if (error) throw new Error(error.message);
      return data;
    }
    return localDB.usuarios.update(id, fields);
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

// ── POST /auth/login ─────────────────────────────────────────
// Anti fuerza bruta por IP: máx. 20 intentos FALLIDOS cada 15 min.
// Solo cuenta fallos (un login correcto limpia el contador) y el
// superadmin nunca queda bloqueado: siempre puede iniciar sesión.
const LOGIN_MAX = 20;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFails = new Map(); // ip -> { count, reset }
const ipDe = req => req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
function loginBloqueado(ip) {
  const rec = loginFails.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.reset) { loginFails.delete(ip); return false; }
  return rec.count >= LOGIN_MAX;
}
function loginFallo(ip) {
  const now = Date.now();
  let rec = loginFails.get(ip);
  if (!rec || now > rec.reset) { rec = { count: 0, reset: now + LOGIN_WINDOW_MS }; loginFails.set(ip, rec); }
  rec.count++;
}
const loginReset = ip => loginFails.delete(ip);

router.post('/login', async (req, res) => {
  try {
    const ip = ipDe(req);
    const { email, password, empresa: empresaSlug } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email y contraseña requeridos' });

    const usuario = await db.findUserByEmail(email.toLowerCase().trim());
    const esSuper = !!usuario && usuario.rol === 'superadmin';

    // El bloqueo por fuerza bruta NO aplica al superadmin.
    if (!esSuper && loginBloqueado(ip))
      return res.status(429).json({ error: 'Demasiados intentos de inicio de sesión. Espera unos minutos.' });

    // Mismo mensaje para email no encontrado y contraseña incorrecta — evita enumeración
    if (!usuario) { loginFallo(ip); return res.status(401).json({ error: 'Credenciales inválidas' }); }
    if (!usuario.activo) return res.status(403).json({ error: 'Cuenta desactivada' });

    const ok = await bcrypt.compare(password, usuario.password_hash);
    if (!ok) { if (!esSuper) loginFallo(ip); return res.status(401).json({ error: 'Credenciales inválidas' }); }

    // Validar empresa si se envió en el formulario
    // superadmin no tiene empresa asignada → se omite la validación
    if (empresaSlug && usuario.rol !== 'superadmin') {
      const empresa = await db.findEmpresaBySlug(empresaSlug.toLowerCase().trim());
      if (!empresa) {
        loginFallo(ip);
        return res.status(401).json({ error: 'Empresa no encontrada o inactiva' });
      }
      if (empresa.id !== usuario.empresa_id) {
        loginFallo(ip);
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }
    }

    // Si no es superadmin y no envió empresa, igual puede entrar
    // (el campo es opcional en el frontend para mantener compatibilidad)

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

    loginReset(ip); // login correcto → limpia el contador de fallos de esta IP
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, usuario: payload });
  } catch (err) {
    console.error('/auth/login:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /auth/register-superadmin ────────────────────────────
// Solo dev; crea el primer superadmin
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

// ── POST /auth/crear-empresa ──────────────────────────────────
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

// ── POST /auth/crear-usuario ──────────────────────────────────
router.post('/crear-usuario', authMiddleware, async (req, res) => {
  try {
    const { rol: rolCreador, empresa_id: empresaCreador } = req.user;
    const { nombre, email, password, rol, empresa_id, rut, cargo, area_id } = req.body;

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

    const empresaFinal = rol === 'superadmin' ? null : (empresa_id || empresaCreador);

    // RUT (opcional): valida dígito verificador y unicidad ANTES de crear
    let rutNorm = null;
    if (rut) {
      if (!validarRut(rut))
        return res.status(400).json({ error: 'RUT inválido (dígito verificador incorrecto)' });
      rutNorm = normalizarRut(rut);
      if (await gestionDB.perfilByRut(rutNorm))
        return res.status(409).json({ error: 'Ese RUT ya está registrado' });
    }

    // Área (opcional): debe pertenecer a la empresa del usuario
    if (area_id) {
      const area = await gestionDB.areaById(area_id);
      if (!area || area.empresa_id !== empresaFinal)
        return res.status(400).json({ error: 'El área no pertenece a esta empresa' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const usuario = await db.insertUsuario({
      nombre,
      email: email.toLowerCase().trim(),
      password_hash,
      rol,
      empresa_id: empresaFinal,
      activo: true
    });

    // Perfil (RUT / cargo) y asignación de área, ya con el id del usuario
    if (rutNorm || cargo)
      await gestionDB.perfilUpsert({ usuario_id: usuario.id, rut: rutNorm, nombre, cargo: cargo || null });
    if (area_id)
      await gestionDB.usuarioAreaUpsert(usuario.id, area_id, req.user.usuario_id);

    res.json({ ok: true, usuario });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /auth/crear-area ─────────────────────────────────────
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

// ── POST /auth/asignar-area ───────────────────────────────────
router.post('/asignar-area', authMiddleware, requireRol('superadmin', 'admin_empresa'), async (req, res) => {
  try {
    const { usuario_id, area_id } = req.body;
    if (!usuario_id || !area_id)
      return res.status(400).json({ error: 'usuario_id y area_id requeridos' });

    const area = await db.getAreaById(area_id);
    if (!area) return res.status(404).json({ error: 'Área no encontrada' });
    if (!canAccessTenant(req, area.empresa_id))
      return res.status(403).json({ error: 'Área no pertenece a tu empresa' });

    await db.upsertUsuarioArea(usuario_id, area_id, req.user.usuario_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET /auth/empresas ────────────────────────────────────────
router.get('/empresas', authMiddleware, requireRol('superadmin'), async (req, res) => {
  try {
    res.json(await db.listEmpresas());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /auth/usuarios ────────────────────────────────────────
router.get('/usuarios', authMiddleware, async (req, res) => {
  try {
    const { rol, empresa_id } = req.user;
    const filtro = rol === 'superadmin' ? null : empresa_id;
    res.json(await db.listUsuarios(filtro));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /auth/areas ───────────────────────────────────────────
router.get('/areas', authMiddleware, async (req, res) => {
  try {
    const { rol, empresa_id } = req.user;
    if (!empresa_id && rol !== 'superadmin')
      return res.status(400).json({ error: 'empresa_id requerido' });
    // Solo superadmin puede consultar áreas de otra empresa vía query param.
    const empId = rol === 'superadmin' ? (req.query.empresa_id || empresa_id) : empresa_id;
    res.json(await db.listAreasByEmpresa(empId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /auth/personal ────────────────────────────────────────
// Lista supervisores y técnicos para los dropdowns del formulario
router.get('/personal', authMiddleware, async (req, res) => {
  try {
    const { rol, empresa_id } = req.user;
    const filtro = rol === 'superadmin' ? null : empresa_id;
    const todos = await db.listUsuarios(filtro);
    const personal = todos.filter(u => ['supervisor','tecnico'].includes(u.rol) && u.activo);
    res.json(personal.map(u => ({ id: u.id, nombre: u.nombre, rol: u.rol })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /auth/usuarios/:id ──────────────────────────────────
// Solo superadmin: editar correo, contraseña, rol y empresa de cualquier usuario
router.patch('/usuarios/:id', authMiddleware, requireRol('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, email, password, rol, empresa_id } = req.body;
    const fields = {};

    if (nombre !== undefined) fields.nombre = nombre.trim();
    if (email !== undefined) {
      const e = email.toLowerCase().trim();
      if (!e) return res.status(400).json({ error: 'Email no puede quedar vacío' });
      fields.email = e;
    }
    if (rol !== undefined) {
      if (!['superadmin','admin_empresa','supervisor','tecnico'].includes(rol))
        return res.status(400).json({ error: 'Rol inválido' });
      fields.rol = rol;
    }
    if (empresa_id !== undefined) fields.empresa_id = empresa_id || null;
    // superadmin no pertenece a ninguna empresa
    if ((fields.rol || '') === 'superadmin') fields.empresa_id = null;

    if (password !== undefined && password !== '') {
      if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener 6+ caracteres' });
      fields.password_hash = await bcrypt.hash(password, 12);
    }

    if (!Object.keys(fields).length)
      return res.status(400).json({ error: 'Nada para actualizar' });

    const usuario = await db.updateUsuario(id, fields);
    res.json({ ok: true, usuario });
  } catch (err) {
    // email duplicado u otros errores de BD
    const msg = /unique|duplicate/i.test(err.message) ? 'Ese correo ya está en uso' : err.message;
    res.status(400).json({ error: msg });
  }
});

// ── DELETE /auth/usuarios/:id ─────────────────────────────────
// Solo superadmin puede eliminar usuarios
router.delete('/usuarios/:id', authMiddleware, requireRol('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user.usuario_id)
      return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    await db.deleteUsuario(id);
    audit.registrar(req, 'borrar', 'usuario', id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /auth/password ────────────────────────────────────────
// Autoservicio: cualquier usuario autenticado cambia su propia contraseña
// (a diferencia de PATCH /auth/usuarios/:id, que es un admin reseteando la
// de otra persona). Exige la contraseña actual para confirmar identidad.
router.put('/password', authMiddleware, async (req, res) => {
  try {
    const { password_actual, password_nueva } = req.body;
    if (!password_actual || !password_nueva)
      return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
    if (password_nueva.length < 6)
      return res.status(400).json({ error: 'La nueva contraseña debe tener 6+ caracteres' });

    const usuario = await db.findUserById(req.user.usuario_id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const ok = await bcrypt.compare(password_actual, usuario.password_hash);
    if (!ok) return res.status(401).json({ error: 'La contraseña actual no es correcta' });

    const password_hash = await bcrypt.hash(password_nueva, 12);
    await db.updateUsuario(usuario.id, { password_hash });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /auth/me ──────────────────────────────────────────────
// Devuelve el usuario del token + datos de presentación (cargo y áreas).
// El dashboard los usa para mostrar "información de la persona" a
// supervisores/administradores; los técnicos solo ven su nombre.
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const u = req.user;
    let cargo = null, nombre = null, apellidos = null, areas = [];

    try {
      const perfil = await gestionDB.perfilByUsuario(u.usuario_id);
      if (perfil) { cargo = perfil.cargo || null; nombre = perfil.nombre || null; apellidos = perfil.apellidos || null; }
    } catch { /* perfil opcional */ }

    const ids = Array.isArray(u.areas_permitidas) ? u.areas_permitidas : [];
    if (ids.length) {
      const list = await Promise.all(ids.map(id => gestionDB.areaById(id).catch(() => null)));
      areas = list.filter(Boolean).map(a => ({ id: a.id, nombre: a.nombre }));
    }

    res.json({ usuario: u, perfil: { cargo, nombre, apellidos }, areas });
  } catch (err) {
    // Ante cualquier fallo, no romper la sesión: devolver al menos el usuario.
    res.json({ usuario: req.user, perfil: { cargo: null, nombre: null, apellidos: null }, areas: [] });
  }
});

module.exports = router;
