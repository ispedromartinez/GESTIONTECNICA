require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { buildHtmlPreventivo } = require('./templates/preventivo-html');
// Ruta de Chrome configurable por entorno (en Linux/producción NO existe la ruta de Windows).
// Define CHROME_PATH en .env; por defecto usa la ubicación típica de Chrome en Windows.
const CHROME_PATH = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const nodemailer = require('nodemailer');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        ImageRun, AlignmentType, WidthType, BorderStyle, ShadingType,
        VerticalAlign, Header, TextDirection } = require('docx');
const authRoutes = require('./routes/auth');
const gestionRoutes = require('./routes/gestion');
const empresasRoutes = require('./routes/empresas');
const preventivoRoutes = require('./routes/preventivo');
const gestionDb = require('./db/gestion');
const equiposDb = require('./db/equipos');
const { authMiddleware } = require('./middleware/auth');
const { requireRol, requireNivel } = require('./middleware/roles');
const { requireModulo } = require('./middleware/modulos');
const { canAccessTenant, scopeToTenant } = require('./middleware/tenant');
const { rateLimit } = require('./middleware/rateLimit');

// Cliente Supabase compartido (respeta USE_LOCAL_DB, igual que el resto de la app)
const { supabase } = require('./db/supabase');
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'documentos-word';

if (supabase) {
  supabase.from('informes_clima').select('id').limit(1)
    .then(({ error }) => {
      if (error) console.error('⚠️  Supabase conectado pero error de acceso:', error.message);
      else console.log('✅ Supabase conectado correctamente');
    });
} else if (process.env.USE_LOCAL_DB === 'true') {
  console.warn('🗄️  USE_LOCAL_DB=true → toda la app (informes incluidos) usa archivos locales / SQLite.');
} else {
  console.warn('⚠️  Supabase NO configurado — falta SUPABASE_URL o SUPABASE_KEY. Usando archivos locales.');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Detrás del proxy de Render: sin esto req.ip sería la IP del proxy y el
// rate limiting metería a todos los usuarios en el mismo saco.
app.set('trust proxy', 1);

// Headers de seguridad estándar. CSP off: los HTML usan scripts inline.
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS restringido: solo orígenes conocidos ──────────────────
// La app se sirve same-origin (el propio servidor entrega los HTML), así que
// solo hace falta permitir el propio dominio, la LAN y lo definido por env.
const allowedOrigins = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  ...(process.env.ALLOWED_ORIGIN ? [process.env.ALLOWED_ORIGIN] : []),
  ...(process.env.RENDER_EXTERNAL_URL ? [process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')] : []),
];
const lanOriginPattern = new RegExp(`^http://192\\.168\\.\\d{1,3}\\.\\d{1,3}:${PORT}$`);
// Cualquier subdominio https de Render (el sitio llamándose a sí mismo)
const renderOriginPattern = /^https:\/\/[a-z0-9-]+\.onrender\.com$/i;
app.use(cors({
  origin(origin, cb) {
    // Sin header Origin = petición same-origin o herramienta tipo curl: permitir
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin) || lanOriginPattern.test(origin) || renderOriginPattern.test(origin)) {
      return cb(null, true);
    }
    cb(new Error('Origen no permitido por CORS'));
  }
}));

// ── Rate limiting global + limitador para rutas pesadas ────────
app.use(rateLimit({ windowMs: 60 * 1000, max: 300, message: 'Demasiadas solicitudes, intenta más tarde.' }));

// Gzip para HTML/CSS/JS/JSON: en móvil (4G) reduce ~70% lo transferido.
app.use(require('compression')());
app.use(express.json({ limit: '80mb' }));

// ── Seguridad: la raíz del proyecto se sirve estática, pero JAMÁS deben
// salir por ahí datos ni código del servidor. Sin este guard, cualquiera
// sin login podía descargar auth.db (hashes de contraseñas), registro*.json,
// contactos.json, los .docx/.pdf de informes y el código fuente completo.
const STATIC_DIR_BLOCK = /^\/(db|middleware|routes|templates|utils|schema|react|node_modules|documentos_md|informes(_wom|_prev)?|papelera(_wom|_prev)?)(\/|$)/i;
const STATIC_EXT_BLOCK = /\.(json|xlsx|xls|docx|pdf|db|db-shm|db-wal|md|txt|env|log|sqlite)$/i;
const STATIC_FILE_BLOCK = new Set(['/server.js', '/ecosystem.config.js']);
app.use((req, res, next) => {
  let p;
  try { p = decodeURIComponent(req.path); } catch { return res.status(400).json({ error: 'Ruta inválida' }); }
  p = p.replace(/\\/g, '/');
  if (STATIC_DIR_BLOCK.test(p) || STATIC_EXT_BLOCK.test(p) || STATIC_FILE_BLOCK.has(p.toLowerCase())) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  next();
});

// No cachear los HTML: el navegador siempre carga la última versión
// (evita ver pantallas viejas tras un cambio). El resto de assets sí se cachea.
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// ── Auth routes (públicas: /auth/login, /auth/register-superadmin)
app.use('/auth', authRoutes);

// ── Gestión: perfiles, proyectos, asignaciones, informes (modelo relacional)
// Todas las rutas exigen sesión y aplican las reglas de negocio por empresa.
app.use('/api/gestion', gestionRoutes);

// ── Gestión de clientes (empresas) y usuarios — superadmin
app.use('/api', empresasRoutes);

// ── Mantenimiento Preventivo: tareas (API protegida con login)
app.use('/tareas', authMiddleware, requireModulo('preventivo'), preventivoRoutes);

// Las páginas HTML se sirven SIEMPRE sin caché: el estático ya lo hace para
// *.html directos, pero estas rutas usan sendFile y sin esto el navegador
// (sobre todo en el teléfono) se quedaba con versiones viejas de la app.
function sendPage(res, file) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, file));
}
app.get('/', (req, res) => sendPage(res, 'landing.html'));
app.get('/login', (req, res) => sendPage(res, 'login.html'));
app.get('/selector', (req, res) => res.redirect(301, '/dashboard')); // unificado: el nodo central es /dashboard
app.get('/tigo', (req, res) => sendPage(res, 'informe_clima_app.html'));
app.get('/wom', (req, res) => sendPage(res, 'informe_wom_app.html'));
app.get('/admin', (req, res) => sendPage(res, 'admin.html'));
app.get('/dashboard', (req, res) => sendPage(res, 'dashboard.html'));
app.get('/panel', (req, res) => sendPage(res, 'panel_tecnico.html')); // panel del técnico
app.get('/preventivo', (req, res) => sendPage(res, 'preventivo.html')); // mantenimiento preventivo
app.get('/perfil', (req, res) => sendPage(res, 'perfil.html')); // perfil del usuario
app.get('/nuevo-proyecto', (req, res) => sendPage(res, 'nuevo_proyecto.html'));
app.get('/catalogo', (req, res) => sendPage(res, 'catalogo.html')); // catálogo de sitios
app.get('/proyecto/:slug', (req, res) => sendPage(res, 'proyecto.html'));

// ── Proyectos personalizados ──────────────────────────────────
const PROYECTOS_FILE = path.join(__dirname, 'proyectos.json');
const LOGOS_DIR = path.join(__dirname, 'logos');
if (!fs.existsSync(PROYECTOS_FILE)) fs.writeFileSync(PROYECTOS_FILE, '[]');
if (!fs.existsSync(LOGOS_DIR)) fs.mkdirSync(LOGOS_DIR);
app.use('/logos', express.static(LOGOS_DIR));

function loadProyectos() { try { return JSON.parse(fs.readFileSync(PROYECTOS_FILE,'utf8')); } catch(e) { return []; } }
function saveProyectos(d) { fs.writeFileSync(PROYECTOS_FILE, JSON.stringify(d, null, 2)); }
function uuidSimple() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r=Math.random()*16|0; return(c==='x'?r:(r&0x3|0x8)).toString(16); }); }

// Slug de proyecto: código corto alfanumérico en minúsculas (no legible a
// propósito — es una clave interna, no algo que el usuario deba escribir).
// Se reintenta hasta que no choque con ninguno de los slugs existentes.
function generarSlugProyecto(existentes) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let slug;
  do {
    slug = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (existentes.includes(slug));
  return slug;
}

const CONTACTO_FILE = path.join(__dirname, 'contactos.json');
function loadContactos() { try { return JSON.parse(fs.readFileSync(CONTACTO_FILE,'utf8')); } catch(e) { return []; } }
const contactoLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 5, message: 'Has enviado demasiados mensajes. Inténtalo más tarde.' });
app.post('/api/contacto', contactoLimiter, express.json(), (req, res) => {
  const { nombre, empresa, email, tel, mensaje, fecha } = req.body || {};
  if (!nombre || !email) return res.status(400).json({ error: 'nombre y email requeridos' });
  // Campos acotados: es un endpoint público, sin tope alguien podía llenar el disco.
  const cap = (s, n) => String(s == null ? '' : s).slice(0, n);
  const lista = loadContactos();
  lista.push({
    nombre: cap(nombre, 120), empresa: cap(empresa, 120), email: cap(email, 160),
    tel: cap(tel, 40), mensaje: cap(mensaje, 2000),
    fecha: new Date().toISOString()
  });
  fs.writeFileSync(CONTACTO_FILE, JSON.stringify(lista, null, 2));
  console.log(`📬 Nuevo contacto: ${nombre} <${email}>`);
  res.json({ ok: true });
});

app.get('/api/proyectos', authMiddleware, (req, res) => {
  // Aislamiento por tenant centralizado (superadmin ve todos).
  const proyectos = scopeToTenant(req, loadProyectos());
  res.json(proyectos.map(p => ({
    id:p.id, slug:p.slug, nombre:p.nombre, logo:p.logo, template:p.template,
    empresa_id:p.empresa_id||null, empresa_nombre:p.empresa_nombre||null,
    color:p.color, totalSitios:p.sitios?.length||0,
    totalTecnicos:p.tecnicos?.length||0, totalSupervisores:p.supervisores?.length||0,
    creado_en:p.creado_en
  })));
});

app.get('/api/proyectos/:slug', authMiddleware, (req, res) => {
  const p = loadProyectos().find(x => x.slug === req.params.slug);
  if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
  // Aislamiento por tenant: sin esto cualquier usuario autenticado leía
  // proyectos (sitios, técnicos, supervisores) de otras empresas.
  if (!canAccessTenant(req, p.empresa_id)) return res.status(403).json({ error: 'Proyecto de otra empresa' });
  res.json(p);
});

app.post('/api/proyectos', authMiddleware, requireRol('superadmin', 'admin_empresa'), async (req, res) => {
  try {
    const { nombre, template, color, sitios, tecnicos, supervisores, logo, tipo, categoria } = req.body;
    if (!nombre || !template) return res.status(400).json({ error: 'nombre y template requeridos' });
    // admin_empresa solo puede crear en SU empresa; superadmin elige la empresa del cuerpo.
    const empresa_id = req.user.rol === 'superadmin' ? req.body.empresa_id : req.user.empresa_id;
    if (!empresa_id) return res.status(400).json({ error: 'Debes seleccionar la empresa del proyecto' });
    // Valida la empresa contra la BD (no se confía en el nombre que envía el cliente)
    const empresa = (await gestionDb.empresasList()).find(e => e.id === empresa_id);
    if (!empresa) return res.status(400).json({ error: 'Empresa no válida' });
    const proyectos = loadProyectos();
    // El slug ya no lo escribe el usuario: se asigna un código corto único.
    const slug = generarSlugProyecto(proyectos.map(p => p.slug));
    let logoPath = null;
    if (logo && logo.startsWith('data:image/')) {
      const ext = (logo.match(/data:image\/(\w+);/)||[])[1]||'png';
      const fname = `${slug}.${ext}`;
      fs.writeFileSync(path.join(LOGOS_DIR, fname), Buffer.from(logo.replace(/^data:image\/\w+;base64,/,''), 'base64'));
      logoPath = `/logos/${fname}`;
    }
    const proyecto = {
      id: uuidSimple(), slug,
      nombre, logo: logoPath, template,
      empresa_id, empresa_nombre: empresa.nombre,
      color: color || (template==='tigo'?'#0073EA':'#6161FF'),
      sitios: sitios||[], tecnicos: tecnicos||[], supervisores: supervisores||[],
      creado_en: new Date().toISOString()
    };
    proyectos.push(proyecto);
    saveProyectos(proyectos);
    const regFile = path.join(__dirname, `registro_${proyecto.slug}.json`);
    if (!fs.existsSync(regFile)) fs.writeFileSync(regFile, '[]');
    // Registrar también el proyecto en el sistema relacional (el que ven el panel
    // Admin, el dashboard y el panel del técnico). No rompe la creación si falla.
    try {
      const TIPOS = ['correctivo', 'preventivo', 'temporal'];
      const CATS = ['clima', 'energia', 'obras_civiles'];
      await gestionDb.proyectoInsert({
        empresa_id, nombre, slug: proyecto.slug, estado: 'activo', fecha_inicio: null,
        logo: logoPath, template, color: proyecto.color,
        tipo: TIPOS.includes(tipo) ? tipo : 'correctivo',
        categoria: CATS.includes(categoria) ? categoria : 'clima'
      });
    } catch (e) { console.error('proyecto relacional:', e.message); }
    res.json({ ok:true, proyecto });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/proyectos/:slug', authMiddleware, requireRol('superadmin'), (req, res) => {
  const ps = loadProyectos();
  const idx = ps.findIndex(p => p.slug === req.params.slug);
  if (idx===-1) return res.status(404).json({ error: 'No encontrado' });
  ps.splice(idx,1); saveProyectos(ps);
  res.json({ ok:true });
});

// ── Asignación de sitios del catálogo a proyectos ────────────────
// Los sitios se guardan como tupla [nombre, direccion, comuna] (la 3.ª pos
// es opcional y compatible con los datos antiguos [nombre, direccion]).
function normSitio(s) {
  if (Array.isArray(s)) return [String(s[0]||'').trim(), String(s[1]||'').trim(), String(s[2]||'').trim()];
  return [String(s.nombre||'').trim(), String(s.direccion||'').trim(), String(s.comuna||s.ciudad||'').trim()];
}
function claveSitio(t) { return (t[0]+'|'+t[1]).toLowerCase(); }
// Mergea sitios nuevos en el proyecto evitando duplicados (por nombre+dirección).
function mergeSitios(proyecto, sitios) {
  proyecto.sitios = proyecto.sitios || [];
  const vistos = new Set(proyecto.sitios.map(s => claveSitio(normSitio(s))));
  for (const raw of (sitios||[])) {
    const t = normSitio(raw);
    if (!t[0]) continue;                       // sin nombre, se ignora
    const k = claveSitio(t);
    if (vistos.has(k)) continue;
    vistos.add(k);
    proyecto.sitios.push(t);
  }
  return proyecto.sitios.length;
}
// El usuario solo puede tocar proyectos de su empresa (superadmin, todas).
function puedeEditarProyecto(user, proyecto) {
  return canAccessTenant({ user }, proyecto && proyecto.empresa_id);
}

// Asignar sitios a UN proyecto
app.post('/api/proyectos/:slug/sitios', authMiddleware, requireNivel(3), (req, res) => {
  const ps = loadProyectos();
  const p = ps.find(x => x.slug === req.params.slug);
  if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
  if (!puedeEditarProyecto(req.user, p)) return res.status(403).json({ error: 'Proyecto de otra empresa' });
  const total = mergeSitios(p, req.body && req.body.sitios);
  saveProyectos(ps);
  res.json({ ok: true, totalSitios: total });
});

// Quitar un sitio de un proyecto (por nombre)
app.delete('/api/proyectos/:slug/sitios', authMiddleware, requireNivel(3), (req, res) => {
  const ps = loadProyectos();
  const p = ps.find(x => x.slug === req.params.slug);
  if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
  if (!puedeEditarProyecto(req.user, p)) return res.status(403).json({ error: 'Proyecto de otra empresa' });
  const nombre = String((req.body && req.body.nombre) || '').trim().toLowerCase();
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
  p.sitios = (p.sitios || []).filter(s => normSitio(s)[0].toLowerCase() !== nombre);
  saveProyectos(ps);
  res.json({ ok: true, totalSitios: p.sitios.length });
});

// Asignación masiva: mismos sitios a varios proyectos
app.post('/api/proyectos/sitios/asignar', authMiddleware, requireNivel(3), (req, res) => {
  const { sitios, slugs } = req.body || {};
  if (!Array.isArray(slugs) || !slugs.length) return res.status(400).json({ error: 'slugs requeridos' });
  const ps = loadProyectos();
  const asignados = [], omitidos = [];
  for (const slug of slugs) {
    const p = ps.find(x => x.slug === slug);
    if (!p || !puedeEditarProyecto(req.user, p)) { omitidos.push(slug); continue; }
    const total = mergeSitios(p, sitios);
    asignados.push({ slug, totalSitios: total });
  }
  saveProyectos(ps);
  res.json({ ok: true, asignados, omitidos });
});

// ── Equipos (hoja de vida de activos) ─────────────────────────
app.get('/api/equipos', authMiddleware, async (req, res) => {
  try {
    let equipos = scopeToTenant(req, await equiposDb.list());
    const sitio = (req.query.sitio || '').trim().toLowerCase();
    if (sitio) equipos = equipos.filter(e => (e.sitio || '').toLowerCase() === sitio);
    const q = (req.query.q || '').trim().toLowerCase();
    if (q) equipos = equipos.filter(e =>
      ['sitio','numero','tipo','marca','modelo'].some(k => (e[k] || '').toLowerCase().includes(q)));
    res.json(equipos);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Historial en vivo: informes TIGO/WOM que corresponden a este equipo.
// Los informes antiguos sin nº de equipo van aparte (delSitio) como contexto.
app.get('/api/equipos/:id/historial', authMiddleware, async (req, res) => {
  try {
    const eq = await equiposDb.findById(req.params.id);
    if (!eq) return res.status(404).json({ error: 'Equipo no encontrado' });
    if (!canAccessTenant(req, eq.empresaId)) return res.status(403).json({ error: 'Equipo de otra empresa' });

    const clave = equiposDb.claveEquipo(eq.sitio, eq.numero);
    const sitioNorm = equiposDb.norm(eq.sitio).toLowerCase();
    const [tigo, wom] = await Promise.all([dbClimaList(null), dbWomList(null)]);
    // Solo informes del mismo tenant que el equipo
    const mismoTenant = r => (r.empresaId || null) === (eq.empresaId || null);

    const historial = [], delSitio = [];
    for (const r of tigo.filter(mismoTenant)) {
      if (equiposDb.norm(r.nombreSitio).toLowerCase() !== sitioNorm) continue;
      const item = {
        tipo: 'TIGO', id: r.id, fecha: r.fecha || (r.fechaCreacion || '').slice(0, 10),
        codigo: r.codInforme || '—', tecnico: r.tecnico || '—',
        filename: r.filename, urlDescarga: `/descargar/${r.id}`
      };
      if (r.eqNumero && equiposDb.claveEquipo(r.nombreSitio, r.eqNumero) === clave) historial.push(item);
      else if (!r.eqNumero) delSitio.push(item);
    }
    for (const r of wom.filter(mismoTenant)) {
      if (equiposDb.norm(r.instalacion).toLowerCase() !== sitioNorm) continue;
      const item = {
        tipo: 'WOM', id: r.id, fecha: (r.fechaInicio || r.fechaCreacion || '').slice(0, 10),
        codigo: r.ticket || r.codInterno || '—', tecnico: r.tecnicos || '—',
        filename: r.filename, urlDescarga: `/descargar-wom/${r.id}`
      };
      if (r.equipo && equiposDb.claveEquipo(r.instalacion, r.equipo) === clave) historial.push(item);
      else if (!r.equipo) delSitio.push(item);
    }
    const porFecha = (a, b) => (b.fecha || '').localeCompare(a.fecha || '');
    historial.sort(porFecha); delSitio.sort(porFecha);
    res.json({ equipo: eq, historial, delSitio });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reconstruye la tabla equipos desde los informes existentes (idempotente).
app.post('/api/equipos/backfill', authMiddleware, requireRol('superadmin'), async (req, res) => {
  try {
    await equiposDb.resetAll();
    const [tigo, wom] = await Promise.all([dbClimaList(null), dbWomList(null)]);
    let procesados = 0;
    for (const r of tigo) {
      if (!r.eqNumero) continue;
      await equiposDb.upsertDesdeInforme({
        empresaId: r.empresaId || null, sitio: r.nombreSitio, numero: r.eqNumero,
        fecha: r.fecha || (r.fechaCreacion || '').slice(0, 10)
      });
      procesados++;
    }
    for (const r of wom) {
      if (!r.equipo) continue;
      await equiposDb.upsertDesdeInforme({
        empresaId: r.empresaId || null, sitio: r.instalacion, numero: r.equipo,
        fecha: (r.fechaInicio || r.fechaCreacion || '').slice(0, 10)
      });
      procesados++;
    }
    const equipos = (await equiposDb.list()).length;
    res.json({ ok: true, procesados, equipos });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/dashboard – datos unificados por rol ─────────────
app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const { nombre, rol } = req.user;
    const [tigoAll, womAll] = await Promise.all([dbClimaList(null), dbWomList(null)]);
    // Aislamiento por empresa antes de cualquier otro recorte por rol
    const tigo = filtrarInformesPorEmpresa(tigoAll, req.user);
    const wom  = filtrarInformesPorEmpresa(womAll, req.user);

    const tigoNorm = tigo.map(r => ({
      id: r.id, proyecto: 'TIGO',
      sitio: r.nombreSitio || '—',
      tecnico: r.tecnico || '—',
      supervisor: r.supervisor || null,
      fecha: r.fecha || (r.fechaCreacion || '').slice(0,10),
      codInforme: r.codInforme || '—'
    }));
    const womNorm = wom.map(r => {
      const tecs = Array.isArray(r.tecnicos) ? r.tecnicos : (r.tecnicos||'').split(',').map(s=>s.trim());
      return {
        id: r.id, proyecto: 'WOM',
        sitio: r.instalacion || '—',
        tecnico: tecs.filter(Boolean).join(', ') || '—',
        supervisor: null,
        fecha: (r.fechaInicio || r.fechaCreacion || '').slice(0,10),
        codInforme: r.ticket || r.codInterno || '—'
      };
    });

    let todos = [...tigoNorm, ...womNorm].sort((a,b) => (b.fecha||'').localeCompare(a.fecha||''));

    const nombreLow = (nombre||'').toLowerCase();
    if (rol === 'tecnico') {
      todos = todos.filter(r => r.tecnico.toLowerCase().includes(nombreLow));
    } else if (rol === 'supervisor') {
      todos = todos.filter(r =>
        (r.supervisor && r.supervisor.toLowerCase().includes(nombreLow)) ||
        r.tecnico.toLowerCase().includes(nombreLow)
      );
    }

    const now = new Date();
    const totalMes = todos.filter(r => {
      const d = new Date(r.fecha); return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth();
    }).length;

    const tecnicosUnicos = [...new Set(todos.map(r=>r.tecnico).filter(t=>t&&t!=='—'))].length;

    res.json({ informes: todos, stats: { totalMes, total: todos.length, tecnicos: tecnicosUnicos } });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

const DOCS_DIR      = path.join(__dirname, 'informes');
const PAPELERA_DIR  = path.join(__dirname, 'papelera');
const DB_FILE       = path.join(__dirname, 'registro.json');
const PAPELERA_FILE = path.join(__dirname, 'papelera.json');
const TAREAS_INFORMES_FILE = path.join(__dirname, 'tareas_informes.json');

if (!fs.existsSync(DOCS_DIR))     fs.mkdirSync(DOCS_DIR);
if (!fs.existsSync(PAPELERA_DIR)) fs.mkdirSync(PAPELERA_DIR);
if (!fs.existsSync(DB_FILE))      fs.writeFileSync(DB_FILE, '[]');
if (!fs.existsSync(PAPELERA_FILE))fs.writeFileSync(PAPELERA_FILE, '[]');
if (!fs.existsSync(TAREAS_INFORMES_FILE)) fs.writeFileSync(TAREAS_INFORMES_FILE, '{}');

function loadTareasInformes() { try { return JSON.parse(fs.readFileSync(TAREAS_INFORMES_FILE,'utf8')); } catch { return {}; } }
function saveTareasInformes(m) { fs.writeFileSync(TAREAS_INFORMES_FILE, JSON.stringify(m, null, 2)); }

// ── Seguridad: sanitización de búsquedas ──────────────────────
// El texto del buscador NUNCA se interpola en SQL — viaja como
// parámetro ($1) para que el motor lo trate como dato, no como código.
function sanitizeSearch(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw
    .replace(/\0/g, '')        // null bytes (vector de ataque clásico)
    .replace(/[,()]/g, ' ')    // delimitadores de sintaxis PostgREST/SQL
    .trim()
    .slice(0, 100);            // longitud máxima — evita queries enormes
  return clean || null;
}

// Escapa wildcards de LIKE para que el texto sea literal en BD
// sin esto, buscar "50%" filtraría registros que empiecen con 50
function escapeLike(s) {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ── Aislamiento multi-tenant para informes (clima/wom/prev) ────
// Delegan en el módulo central de tenant (middleware/tenant.js): superadmin ve
// todo; el resto SOLO su propio tenant; informes legado sin tenant → solo superadmin.
function filtrarInformesPorEmpresa(rows, user) {
  return scopeToTenant({ user }, rows, r => r.empresaId);
}
// ¿Este usuario puede acceder a un informe concreto (por id)?
function puedeVerInforme(entry, user) {
  return canAccessTenant({ user }, entry && entry.empresaId);
}

// Escapa texto antes de inyectarlo en HTML (evita XSS en páginas públicas)
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Local fallback helpers ─────────────────────────────────────
function loadDBLocal()       { try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }       catch { return []; } }
function saveDBLocal(d)      { fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); }
function loadPapeleraLocal() { try { return JSON.parse(fs.readFileSync(PAPELERA_FILE,'utf8')); } catch { return []; } }
function savePapeleraLocal(d){ fs.writeFileSync(PAPELERA_FILE, JSON.stringify(d, null, 2)); }

// ── Row mappers – Clima ────────────────────────────────────────
const fromClima = r => ({
  id: r.id, fecha: r.fecha, fechaCreacion: r.fecha_creacion,
  codInforme: r.cod_informe, nombreSitio: r.nombre_sitio,
  codigoSitio: r.codigo_sitio, tecnico: r.tecnico,
  supervisor: r.supervisor, numOT: r.num_ot,
  lpu: r.lpu || null, circuito: r.circuito || null,
  photoCount: r.photo_count, filename: r.filename,
  eqNumero: r.eq_numero || null,
  empresaId: r.empresa_id || null
});
const toClima = e => ({
  id: e.id, fecha: e.fecha, fecha_creacion: e.fechaCreacion,
  cod_informe: e.codInforme, nombre_sitio: e.nombreSitio,
  codigo_sitio: e.codigoSitio, tecnico: e.tecnico,
  supervisor: e.supervisor, num_ot: e.numOT,
  lpu: e.lpu || null, circuito: e.circuito || null,
  photo_count: e.photoCount, filename: e.filename,
  eq_numero: e.eqNumero || null,
  empresa_id: e.empresaId || null
});

// ── Supabase Storage helpers ───────────────────────────────────
async function storageUpload(buffer, storagePath, contentType) {
  if (!supabase) return;
  const { error } = await supabase.storage.from(SUPABASE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true
    });
  if (error) console.error('storageUpload error:', error.message);
}

async function storageDownload(storagePath) {
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).download(storagePath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function storageMove(fromPath, toPath) {
  if (!supabase) return;
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).move(fromPath, toPath);
  if (error) console.error('storageMove error:', error.message);
}

async function storageRemove(paths) {
  if (!supabase) return;
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove(paths);
  if (error) console.error('storageRemove error:', error.message);
}

// ── Async DB – Informes Clima ──────────────────────────────────
async function dbClimaList(q) {
  if (supabase) {
    let query = supabase.from('informes_clima')
      .select('*').order('fecha_creacion', { ascending: false });
    if (q) {
      // El valor viaja como parámetro $1 vía PostgREST — nunca interpolado en SQL
      const like = `%${escapeLike(q)}%`;
      query = query.or(
        `nombre_sitio.ilike.${like},cod_informe.ilike.${like},tecnico.ilike.${like},num_ot.ilike.${like}`
      );
    }
    const { data, error } = await query;
    if (!error) return (data||[]).map(fromClima);
    console.error('dbClimaList:', error.message);
  }
  // Fallback JSON local: filtrado en JS puro — sin SQL, sin riesgo de inyección
  const db = loadDBLocal();
  if (!q) return db;
  const ql = q.toLowerCase();
  return db.filter(r => ['nombreSitio','codInforme','tecnico','numOT']
    .some(k => (r[k]||'').toLowerCase().includes(ql)));
}

async function dbClimaInsert(entry) {
  if (supabase) {
    const { error } = await supabase.from('informes_clima').insert(toClima(entry));
    if (error) console.error('dbClimaInsert:', error.message);
  } else {
    const db = loadDBLocal(); db.unshift(entry); saveDBLocal(db);
  }
}

async function dbClimaFind(id) {
  if (supabase) {
    const { data, error } = await supabase.from('informes_clima')
      .select('*').eq('id', id).single();
    if (!error && data) return fromClima(data);
  }
  return loadDBLocal().find(r => r.id === id) || null;
}

async function dbClimaDelete(id) {
  if (supabase) {
    const { error } = await supabase.from('informes_clima').delete().eq('id', id);
    if (error) console.error('dbClimaDelete:', error.message);
  } else {
    saveDBLocal(loadDBLocal().filter(r => r.id !== id));
  }
}

// ── Async DB – Papelera Clima ──────────────────────────────────
async function dbPapeleraList(q) {
  if (supabase) {
    let query = supabase.from('papelera_clima')
      .select('*').order('fecha_eliminado', { ascending: false });
    if (q) {
      const like = `%${escapeLike(q)}%`;
      query = query.or(
        `nombre_sitio.ilike.${like},cod_informe.ilike.${like},tecnico.ilike.${like}`
      );
    }
    const { data, error } = await query;
    if (!error) return (data||[]).map(r => ({ ...fromClima(r), fechaEliminado: r.fecha_eliminado }));
    console.error('dbPapeleraList:', error.message);
  }
  const p = loadPapeleraLocal();
  if (!q) return p;
  const ql = q.toLowerCase();
  return p.filter(r => ['nombreSitio','codInforme','tecnico']
    .some(k => (r[k]||'').toLowerCase().includes(ql)));
}

async function dbPapeleraInsert(entry) {
  if (supabase) {
    const row = { ...toClima(entry), fecha_eliminado: entry.fechaEliminado };
    const { error } = await supabase.from('papelera_clima').insert(row);
    if (error) console.error('dbPapeleraInsert:', error.message);
  } else {
    const p = loadPapeleraLocal(); p.unshift(entry); savePapeleraLocal(p);
  }
}

async function dbPapeleraFind(id) {
  if (supabase) {
    const { data, error } = await supabase.from('papelera_clima')
      .select('*').eq('id', id).single();
    if (!error && data) return { ...fromClima(data), fechaEliminado: data.fecha_eliminado };
  }
  return loadPapeleraLocal().find(r => r.id === id) || null;
}

async function dbPapeleraDelete(id) {
  if (supabase) {
    const { error } = await supabase.from('papelera_clima').delete().eq('id', id);
    if (error) console.error('dbPapeleraDelete:', error.message);
  } else {
    savePapeleraLocal(loadPapeleraLocal().filter(r => r.id !== id));
  }
}

async function dbPapeleraClear() {
  if (supabase) {
    const { error } = await supabase.from('papelera_clima').delete().neq('id', '');
    if (error) console.error('dbPapeleraClear:', error.message);
  } else {
    savePapeleraLocal([]);
  }
}

// ── Design tokens (matching original exactly) ─────────────
const BL  = 'DEEAF6';   // azul claro — celdas etiqueta
const BL2 = 'D9E2F3';   // azul medio — sub-headers
const GH  = 'D9D9D9';   // gris — headers sección
const BC  = '7B7B7B';   // color borde
const TW  = 9869;       // ancho tabla principal (igual al header original)

// Borders: thin=4 (like original sz:4), used everywhere
const thinB = (color=BC) => ({ style: BorderStyle.SINGLE, size: 12, color });
const allThin = { top: thinB(), bottom: thinB(), left: thinB(), right: thinB() };

const mkPara = (text, opts={}) => new Paragraph({
  alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
  spacing: { before: 0, after: 0 },
  children: [new TextRun({
    text: text || '', bold: opts.bold||false, italics: opts.italics||false,
    size: opts.sz || 18, font: 'Calibri', color: opts.color||'000000'
  })]
});

// Label cell (blue bg)
const LC = (text, w, span=1, fill=BL) => new TableCell({
  width: { size: w, type: WidthType.DXA },
  ...(span > 1 ? { columnSpan: span } : {}),
  borders: allThin,
  shading: { fill, type: ShadingType.CLEAR },
  verticalAlign: VerticalAlign.CENTER,
  margins: { top: 40, bottom: 40, left: 70, right: 40 },
  children: [mkPara(text, { bold: true, sz: 16 })]
});

// Value cell (white)
const VC = (text, w, span=1) => new TableCell({
  width: { size: w, type: WidthType.DXA },
  ...(span > 1 ? { columnSpan: span } : {}),
  borders: allThin,
  verticalAlign: VerticalAlign.CENTER,
  margins: { top: 40, bottom: 40, left: 70, right: 40 },
  children: [mkPara(text || '', { sz: 16, center: true })]
});

// Column header cell (blue2 bg, centered, bold)
const HC = (text, w, span=1, rowSpan=1) => new TableCell({
  width: { size: w, type: WidthType.DXA },
  ...(span > 1 ? { columnSpan: span } : {}),
  ...(rowSpan > 1 ? { rowSpan } : {}),
  borders: allThin,
  shading: { fill: BL2, type: ShadingType.CLEAR },
  verticalAlign: VerticalAlign.CENTER,
  margins: { top: 30, bottom: 30, left: 30, right: 30 },
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    children: [new TextRun({ text: text||'', bold: true, size: 14, font: 'Calibri' })]
  })]
});

// Section header row (full-width gray, ALL CAPS bold)
const secRow = (text) => new TableRow({
  height: { value: 300 },
  children: [new TableCell({
    width: { size: TW, type: WidthType.DXA }, columnSpan: 14,
    borders: allThin,
    shading: { fill: GH, type: ShadingType.CLEAR },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 40, bottom: 40, left: 100, right: 40 },
    children: [mkPara(text, { bold: true, sz: 18 })]
  })]
});

// ── Build DOCX ─────────────────────────────────────────────
async function buildDocx(d) {
  const v = s => (s||'').toString().trim() || 'N/A';
  // Separa el resumen por punto seguido de espacio, cada oración en su propia viñeta
  const splitSentences = text => {
    if (!text || text.trim() === 'N/A') return [text || 'N/A'];
    const parts = text.split(/(?<=\.)\s+/).map(s => s.trim()).filter(Boolean);
    return parts.length > 1 ? parts : [text.trim()];
  };
  const mkBullet = text => new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 0, after: 60 },
    children: [new TextRun({ text: text || '', size: 16, font: 'Calibri', color: '000000' })]
  });

  // ── HEADER with logo ──────────────────────────────────
  const HDR_BLUE  = '1A3A6C';   // azul corporativo ICETEL
  const HDR_BLUE2 = 'D6E4F0';   // azul claro etiquetas COD/FECHA
  const HDR_BRD   = '1A3A6C';   // borde header
  const thinHdr   = (color=HDR_BRD) => ({ style: BorderStyle.SINGLE, size: 12, color });
  const allHdr    = { top: thinHdr(), bottom: thinHdr(), left: thinHdr(), right: thinHdr() };

  let headerChildren = [];
  try {
    // Intenta logo.png primero, luego logo.jpeg como respaldo
    let logoPath = path.join(__dirname, 'logo.png');
    let logoType = 'png';
    if (!fs.existsSync(logoPath)) { logoPath = path.join(__dirname, 'logo.jpeg'); logoType = 'jpeg'; }
    const logoData = fs.readFileSync(logoPath);
    const headerTable = new Table({
      width: { size: TW, type: WidthType.DXA },
      columnWidths: [2563, 4625, 745, 1936],
      borders: {
        top: thinHdr(), bottom: thinHdr(),
        left: thinHdr(), right: thinHdr(),
        insideH: thinHdr(), insideV: thinHdr()
      },
      rows: [
        // Row 1: Logo | CENTRALES CLIMA | COD. | value
        new TableRow({
          height: { value: 450 },
          children: [
            // Logo cell — fondo blanco
            new TableCell({
              width: { size: 2563, type: WidthType.DXA },
              rowSpan: 2,
              borders: allHdr,
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 30, bottom: 30, left: 60, right: 60 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new ImageRun({ data: logoData, transformation: { width: 120, height: 65 }, type: logoType })]
              })]
            }),
            // Title cell — azul corporativo, texto blanco
            new TableCell({
              width: { size: 4625, type: WidthType.DXA },
              borders: allHdr,
              shading: { fill: HDR_BLUE, type: ShadingType.CLEAR },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 20, bottom: 20, left: 70, right: 40 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: 'CENTRALES CLIMA', bold: true, size: 24, font: 'Calibri', color: 'FFFFFF' })]
              })]
            }),
            // COD label
            new TableCell({
              width: { size: 745, type: WidthType.DXA },
              borders: allHdr,
              shading: { fill: HDR_BLUE2, type: ShadingType.CLEAR },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 20, bottom: 20, left: 40, right: 40 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: 'COD.', bold: true, size: 16, font: 'Calibri', color: HDR_BLUE })]
              })]
            }),
            // COD value
            new TableCell({
              width: { size: 1936, type: WidthType.DXA },
              borders: allHdr,
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 20, bottom: 20, left: 40, right: 40 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: v(d.codInforme), size: 16, font: 'Calibri', bold: true })]
              })]
            }),
          ]
        }),
        // Row 2: (logo merged) | INFORME CORRECTIVO CLIMA | FECHA | value
        new TableRow({
          height: { value: 360 },
          children: [
            new TableCell({
              width: { size: 4625, type: WidthType.DXA },
              borders: allHdr,
              shading: { fill: HDR_BLUE, type: ShadingType.CLEAR },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 20, bottom: 20, left: 70, right: 40 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: 'INFORME CORRECTIVO CLIMA', bold: true, size: 22, font: 'Calibri', color: 'FFFFFF' })]
              })]
            }),
            new TableCell({
              width: { size: 745, type: WidthType.DXA },
              borders: allHdr,
              shading: { fill: HDR_BLUE2, type: ShadingType.CLEAR },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 20, bottom: 20, left: 40, right: 40 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: 'FECHA', bold: true, size: 16, font: 'Calibri', color: HDR_BLUE })]
              })]
            }),
            new TableCell({
              width: { size: 1936, type: WidthType.DXA },
              borders: allHdr,
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 20, bottom: 20, left: 40, right: 40 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: v(d.fecha), size: 16, font: 'Calibri' })]
              })]
            }),
          ]
        })
      ]
    });
    headerChildren = [headerTable, new Paragraph({ spacing: { before: 0, after: 0 }, children: [] })];
  } catch(e) {
    console.log('Logo not found, skipping:', e.message);
    headerChildren = [new Paragraph({ children: [] })];
  }

  // ── MAIN TABLE ────────────────────────────────────────
  // Col widths matching original exactly (14 cols summing to TW=9869)
  // Proportionally scaled from 11231 → 9869
  const scale = 9869 / 11231;
  const cw = [2827,517,528,782,269,1056,1050,262,787,527,523,790,261,1052];
  const scaled = cw.map(w => Math.round(w * scale));
  // Fix rounding to sum exactly to TW
  const diff = TW - scaled.reduce((a,b)=>a+b,0);
  scaled[0] += diff;

  // ── INFO GENERAL ──────────────────────────────────────
  const row_ig = secRow('INFORMACION GENERAL');
  const row_sitio = new TableRow({ height:{value:280}, children:[
    LC('Nombre de Sitio', scaled[0]+scaled[1], 2),
    VC(v(d.nombreSitio), scaled[2]+scaled[3]+scaled[4]+scaled[5], 4),
    LC('Código de Sitio', scaled[6]+scaled[7]+scaled[8]+scaled[9], 4),
    VC(v(d.codigoSitio), scaled[10]+scaled[11]+scaled[12]+scaled[13], 4)
  ]});
  const row_dir = new TableRow({ height:{value:280}, children:[
    LC('Dirección', scaled[0]+scaled[1], 2),
    VC(v(d.direccion), TW-(scaled[0]+scaled[1]), 12)
  ]});

  const w_tk_label = scaled[0]+scaled[1];
  const w_tk_inc   = scaled[2]+scaled[3];
  const w_tk_te    = scaled[4]+scaled[5];
  const w_tk_ti    = scaled[6]+scaled[7];
  const w_tk_red   = scaled[8]+scaled[9];
  const w_tk_ot    = scaled[10]+scaled[11];
  const w_tk_otv   = scaled[12]+scaled[13];

  const row_tk = new TableRow({ height:{value:280}, children:[
    new TableCell({ width:{size:w_tk_label,type:WidthType.DXA}, columnSpan:2, rowSpan:2,
      borders:allThin, shading:{fill:BL,type:ShadingType.CLEAR},
      verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:70,right:40},
      children:[mkPara('Números de Tickets',{bold:true,sz:16})] }),
    LC('Inc.', w_tk_inc, 2, BL2), LC('TE', w_tk_te, 2, BL2),
    LC('TI', w_tk_ti, 2, BL2), LC('RED', w_tk_red, 2, BL2),
    LC('Numero de OT', w_tk_ot, 2, BL2), VC('', w_tk_otv, 2)
  ]});
  const row_tk2 = new TableRow({ height:{value:260}, children:[
    VC(v(d.ticketInc), w_tk_inc, 2), VC(v(d.ticketTE), w_tk_te, 2),
    VC(v(d.ticketTI), w_tk_ti, 2), VC(v(d.ticketRED), w_tk_red, 2),
    new TableCell({ width:{size:w_tk_ot,type:WidthType.DXA}, columnSpan:2,
      borders:allThin, shading:{fill:BL2,type:ShadingType.CLEAR},
      verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:40,right:40},
      children:[mkPara('')] }),
    VC(v(d.numOT), w_tk_otv, 2)
  ]});

  const row_lpu = new TableRow({ height:{value:280}, children:[
    LC('LPU', w_tk_label, 2),
    VC(v(d.lpu), TW-w_tk_label, 12)
  ]});

  const row_sala = new TableRow({ height:{value:280}, children:[
    LC('Sala', w_tk_label, 2),
    VC(v(d.sala), w_tk_inc+w_tk_te+w_tk_ti+w_tk_red, 8),
    LC('Fecha Ejecución', w_tk_ot, 2, BL2),
    VC(v(d.fecha), w_tk_otv, 2)
  ]});
  const row_tec = new TableRow({ height:{value:280}, children:[
    LC('Técnico Ejecutante', w_tk_label, 2),
    VC(v(d.tecnico), w_tk_inc+w_tk_te, 4),
    LC('Supervisor', w_tk_ti+w_tk_red, 4),
    VC(v(d.supervisor), w_tk_ot+w_tk_otv, 4)
  ]});

  // ── RESUMEN ───────────────────────────────────────────
  const row_rs = secRow('RESUMEN DE LA ACTIVIDAD');
  const row_rs2 = new TableRow({ height:{value:2200}, children:[
    new TableCell({ width:{size:TW,type:WidthType.DXA}, columnSpan:14,
      borders:allThin, margins:{top:60,bottom:60,left:100,right:100},
      children: splitSentences(v(d.resumen)).map(linea => mkBullet(linea)) })
  ]});

  // ── EQUIPAMIENTO ─────────────────────────────────────
  const row_eq  = secRow('DATOS GENERALES DEL EQUIPAMIENTO');
  const w_eq1 = Math.round(TW*0.23), w_eq2 = Math.round(TW*0.17), w_eq3 = Math.round(TW*0.19),
        w_eq4 = Math.round(TW*0.22), w_eq5 = TW - w_eq1 - w_eq2 - w_eq3 - w_eq4;
  const row_eq_h = new TableRow({ height:{value:280}, children:[
    HC('Sala',w_eq1,1), HC('N° Equipo',w_eq2,4), HC('Tipo',w_eq3,2),
    HC('Marca',w_eq4,4), HC('Modelo / Serie',w_eq5,3)
  ]});
  // N° Equipo con circuito: "E1 C5" (E = equipo, C = circuito); sin circuito, solo el número.
  const eqConCircuito = d.circuito ? `E${v(d.eqNumero)} C${v(d.circuito)}` : v(d.eqNumero);
  const row_eq_d = new TableRow({ height:{value:280}, children:[
    VC(v(d.eqSala),w_eq1,1), VC(eqConCircuito,w_eq2,4),
    VC(v(d.eqTipo),w_eq3,2), VC(v(d.eqMarca),w_eq4,4), VC(v(d.eqModelo),w_eq5,3)
  ]});

  // ── MEDICIONES ────────────────────────────────────────
  const row_med = secRow('MEDICIONES GENERALES');
  const mw = Math.floor(TW/14);
  const row_med_h1 = new TableRow({ height:{value:260}, children:[
    HC('N° De Equipo', mw*2, 1, 2),
    HC('Consumo Compresor COMP 1', mw*3, 4),
    HC('Consumo Evaporador', mw*2, 2),
    HC('Consumo Condensador', mw*3, 4),
    HC('Temperatura', TW - mw*2 - mw*3 - mw*2 - mw*3, 3)
  ]});
  const mw2 = Math.floor((mw*3)/2);
  const row_med_h2 = new TableRow({ height:{value:260}, children:[
    HC('V.Prom\n(Volt)', mw2, 2), HC('Corriente\n(Amp)', mw*3-mw2, 2),
    HC('V.Prom\n(Volt)', mw, 1), HC('Corriente\n(Amp)', mw, 1),
    HC('V.Prom\n(Volt)', mw2, 2), HC('Corriente\n(Amp)', mw*3-mw2, 2),
    HC('Inyección\n(°C)', mw, 2),
    HC('Retorno\n(°C)', TW - mw*2 - mw*3 - mw*2 - mw*3 - mw, 1)
  ]});
  const row_med_d = new TableRow({ height:{value:300}, children:[
    VC(v(d.eqNumero), mw*2, 1),
    VC(v(d.m_cv), mw2, 2), VC(v(d.m_ca), mw*3-mw2, 2),
    VC(v(d.m_ev), mw, 1), VC(v(d.m_ea), mw, 1),
    VC(v(d.m_condv), mw2, 2), VC(v(d.m_conda), mw*3-mw2, 2),
    VC(v(d.m_tinj), mw, 2),
    VC(v(d.m_tret), TW - mw*2 - mw*3 - mw*2 - mw*3 - mw, 1)
  ]});

  // ── OBSERVACIONES ─────────────────────────────────────
  const row_obs  = secRow('OBSERVACIONES Y RECOMENDACIONES');
  const row_obs2 = new TableRow({ height:{value:1400}, children:[
    new TableCell({ width:{size:TW,type:WidthType.DXA}, columnSpan:14,
      borders:allThin, margins:{top:60,bottom:60,left:100,right:100},
      children:[mkPara(v(d.observaciones),{sz:16})] })
  ]});

  // ── FOTOS — only rows with at least 1 photo ───────────
  const row_foto_hdr = secRow('REGISTRO FOTOGRAFICO');
  const photoRows = [];

  for (let r = 0; r < 6; r++) {
    const i1 = r*2, i2 = r*2+1;
    const p1 = d.photos && d.photos[i1];
    const p2 = d.photos && d.photos[i2];
    if (!p1 && !p2) continue; // skip empty rows entirely

    const cells = [];
    for (const [idx, photoData] of [[i1,p1],[i2,p2]]) {
      let children = [];
      if (photoData) {
        const base64 = photoData.replace(/^data:image\/\w+;base64,/, '');
        const imgBuf = Buffer.from(base64, 'base64');
        const ext = photoData.startsWith('data:image/png') ? 'png' : 'jpeg';
        // Image sized to fill cell nicely
        const descText = (d.photoDescs && d.photoDescs[idx]) ? d.photoDescs[idx] : `Fig. ${idx+1}`;
        children = [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0 },
            children: [new ImageRun({ data: imgBuf, transformation: { width: 210, height: 158 }, type: ext })]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 40, after: 0 },
            children: [new TextRun({ text: descText, italics: true, bold: true, size: 14, font: 'Calibri' })]
          })
        ];
      } else {
        // Empty slot — just label, no box/border fill
        children = [
          new Paragraph({ spacing:{before:0,after:0}, children:[new TextRun({text:'',size:14})] }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 20, after: 0 },
            children: [new TextRun({ text: `Fig. ${idx+1}`, italics: true, bold: true, size: 14, font: 'Calibri', color: 'CCCCCC' })]
          })
        ];
      }
      cells.push(new TableCell({
        width: { size: Math.floor(TW/2), type: WidthType.DXA },
        columnSpan: 7,
        borders: allThin,
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 40, bottom: 40, left: 60, right: 60 },
        children
      }));
    }
    photoRows.push(new TableRow({ height: { value: 2400 }, children: cells }));
  }

  const mainTable = new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: scaled,
    rows: [
      row_ig, row_sitio, row_dir, row_tk, row_tk2, row_lpu, row_sala, row_tec,
      row_rs, row_rs2,
      row_eq, row_eq_h, row_eq_d,
      row_med, row_med_h1, row_med_h2, row_med_d,
      row_obs, row_obs2,
    ]
  });

  const sectionChildren = [mainTable];

  if (photoRows.length > 0) {
    const photoTable = new Table({
      width: { size: TW, type: WidthType.DXA },
      columnWidths: scaled,
      rows: [row_foto_hdr, ...photoRows]
    });
    sectionChildren.push(
      new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0 }, children: [] }),
      photoTable
    );
  }

  const doc = new Document({
    sections: [{
      headers: { default: new Header({ children: headerChildren }) },
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1701, bottom: 1417, left: 1701, header: 284 }
        }
      },
      children: sectionChildren
    }]
  });

  return Packer.toBuffer(doc);
}

// ── Build PDF Preventivo (Puppeteer + Chrome) ──────────────
async function buildPdfPreventivo(d) {
  const puppeteer = require('puppeteer-core');
  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error(`No se encontró Chrome en "${CHROME_PATH}". Configura la variable CHROME_PATH en .env con la ruta del navegador.`);
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
    headless: 'new'
  });
  try {
    const page = await browser.newPage();
    const html = buildHtmlPreventivo(d);
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    const pdf = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' }
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// ── Routes ────────────────────────────────────────────────
app.get('/ping', (req,res) => res.json({ok:true}));

app.get('/version', (req,res) => {
  try {
    const mtime = fs.statSync(path.join(__dirname, 'informe_clima_app.html')).mtimeMs;
    res.json({ v: mtime });
  } catch { res.json({ v: 0 }); }
});

// Vincula un informe de gestión con el documento recién generado: lo marca
// 'enviado' (generado) y guarda el enlace de descarga. Solo si el usuario es
// el técnico/supervisor asignado o admin. Nunca rompe la generación.
async function vincularInformeGestion(req, gestionInformeId, doc_url, doc_nombre) {
  if (!gestionInformeId) return;
  try {
    const inf = await gestionDb.informeById(gestionInformeId);
    if (!inf) return;
    const u = req.user || {};
    const autorizado = inf.tecnico_id === u.usuario_id || inf.supervisor_id === u.usuario_id
      || ['superadmin', 'admin_empresa'].includes(u.rol);
    if (!autorizado) return;
    await gestionDb.informeSetDocumento(gestionInformeId, doc_url, doc_nombre);
  } catch (e) { console.error('vincularInformeGestion:', e.message); }
}

app.post('/generar', authMiddleware, requireModulo('tigo'), async (req,res) => {
  try {
    const d = req.body;
    const buffer = await buildDocx(d);
    const sitePart = (d.nombreSitio||'Clima').replace(/[^a-zA-Z0-9]/g,'_').slice(0,25);
    // El código viaja al nombre de archivo: solo caracteres seguros (evita
    // path traversal con ../ y roturas del header Content-Disposition).
    const codPart = (d.codInforme||'Informe').replace(/[^a-zA-Z0-9\-_]/g,'_').slice(0,40);
    const fname = `${codPart}_${sitePart}.docx`;
    fs.writeFileSync(path.join(DOCS_DIR, fname), buffer);
    await storageUpload(buffer, `clima/${fname}`);

    const { photos } = d;
    const entry = {
      id: Date.now().toString(),
      fecha: d.fecha, fechaCreacion: new Date().toISOString(),
      codInforme: d.codInforme, nombreSitio: d.nombreSitio,
      codigoSitio: d.codigoSitio, tecnico: d.tecnico,
      supervisor: d.supervisor, numOT: d.numOT,
      lpu: d.lpu || null, circuito: d.circuito || null,
      eqNumero: d.eqNumero || null,
      photoCount: (photos||[]).filter(Boolean).length,
      filename: fname,
      empresaId: req.user.empresa_id || null
    };
    await dbClimaInsert(entry);

    // Hoja de vida: registra/actualiza el equipo. Nunca rompe la generación.
    try {
      await equiposDb.upsertDesdeInforme({
        empresaId: req.user.empresa_id || null,
        sitio: d.nombreSitio, numero: d.eqNumero,
        tipo: d.eqTipo, marca: d.eqMarca, modelo: d.eqModelo,
        fecha: d.fecha
      });
    } catch (e) { console.error('equipos upsert (clima):', e.message); }

    if (d.tareaId) {
      const mapa = loadTareasInformes();
      mapa[d.tareaId] = { informeId: entry.id, filename: fname };
      saveTareasInformes(mapa);
    }
    // Informe de gestión asignado al técnico → marcar generado + enlazar doc.
    await vincularInformeGestion(req, d.gestionInformeId, `/descargar/${entry.id}`, fname);

    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition',`attachment; filename="${fname}"`);
    res.setHeader('Access-Control-Expose-Headers','Content-Disposition');
    res.send(buffer);
  } catch(err) { console.error(err); res.status(500).json({error:err.message}); }
});

app.get('/registro', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const q = sanitizeSearch(req.query.q);
  res.json(filtrarInformesPorEmpresa(await dbClimaList(q), req.user));
});

app.get('/descargar/:id', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const entry = await dbClimaFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  let buffer = await storageDownload(`clima/${entry.filename}`);
  if (!buffer) {
    const fpath = path.join(DOCS_DIR, entry.filename);
    if (!fs.existsSync(fpath)) return res.status(404).json({error:'Archivo no existe'});
    buffer = fs.readFileSync(fpath);
  }
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition',`attachment; filename="${entry.filename}"`);
  res.send(buffer);
});


app.post('/enviar/:id', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const entry = await dbClimaFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  let buffer = await storageDownload(`clima/${entry.filename}`);
  if (!buffer) {
    const fpath = path.join(DOCS_DIR, entry.filename);
    if (!fs.existsSync(fpath)) return res.status(404).json({error:'Archivo no existe'});
    buffer = fs.readFileSync(fpath);
  }
  const {to,smtpHost,smtpPort,smtpUser,smtpPass} = req.body;
  if (!to) return res.status(400).json({error:'Email requerido'});
  // Anti-SSRF: el host/puerto SMTP los pone el cliente. Sin validar, esta
  // ruta autenticada sirve para sondear la red interna (169.254.169.254,
  // 127.x, 10.x, 192.168.x, etc.) o puertos arbitrarios. Se restringe a
  // puertos de correo y se bloquean destinos internos.
  const host = String(smtpHost || 'smtp.gmail.com').trim().toLowerCase();
  const port = Number(smtpPort) || 587;
  if (![25, 465, 587, 2525].includes(port))
    return res.status(400).json({error:'Puerto SMTP no permitido'});
  const esHostInterno =
    host === 'localhost' || host.endsWith('.local') ||
    /^(127\.|10\.|169\.254\.|192\.168\.|0\.0\.0\.0|::1|\[)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (esHostInterno)
    return res.status(400).json({error:'Host SMTP no permitido'});
  try {
    const t = nodemailer.createTransport({ host, port, secure: port === 465, auth:{user:smtpUser,pass:smtpPass} });
    await t.sendMail({ from:smtpUser, to, subject:`Informe - ${entry.nombreSitio} - ${entry.codInforme}`,
      text:`Adjunto informe.\nSitio: ${entry.nombreSitio}\nFecha: ${entry.fecha}\nTécnico: ${entry.tecnico}`,
      attachments:[{filename:entry.filename, content:buffer}] });
    res.json({ok:true});
  } catch(err){ res.status(500).json({error:err.message}); }
});

// Mover a papelera (soft delete)
app.delete('/registro/:id', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const entry = await dbClimaFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  await storageMove(`clima/${entry.filename}`, `clima/papelera/${entry.filename}`);
  try {
    const srcPath = path.join(DOCS_DIR, entry.filename);
    if (fs.existsSync(srcPath)) fs.renameSync(srcPath, path.join(PAPELERA_DIR, entry.filename));
  } catch(e) {}
  await dbClimaDelete(entry.id);
  await dbPapeleraInsert({ ...entry, fechaEliminado: new Date().toISOString() });
  res.json({ok:true});
});

// List papelera
app.get('/papelera', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const q = sanitizeSearch(req.query.q);
  res.json(filtrarInformesPorEmpresa(await dbPapeleraList(q), req.user));
});

// Restore from papelera
app.post('/papelera/restaurar/:id', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const entry = await dbPapeleraFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  await storageMove(`clima/papelera/${entry.filename}`, `clima/${entry.filename}`);
  try {
    const srcPath = path.join(PAPELERA_DIR, entry.filename);
    if (fs.existsSync(srcPath)) fs.renameSync(srcPath, path.join(DOCS_DIR, entry.filename));
  } catch(e) {}
  const { fechaEliminado, ...clean } = entry;
  await dbPapeleraDelete(entry.id);
  await dbClimaInsert(clean);
  res.json({ok:true});
});

// Delete permanently from papelera
app.delete('/papelera/:id', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const entry = await dbPapeleraFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  await storageRemove([`clima/papelera/${entry.filename}`]);
  try {
    const fpath = path.join(PAPELERA_DIR, entry.filename);
    if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
  } catch(e) {}
  await dbPapeleraDelete(entry.id);
  res.json({ok:true});
});

// Empty papelera (solo lo de la propia empresa; superadmin vacía todo)
app.delete('/papelera', authMiddleware, requireModulo('tigo'), async (req,res) => {
  const papelera = filtrarInformesPorEmpresa(await dbPapeleraList(null), req.user);
  if (papelera.length) {
    await storageRemove(papelera.map(e => `clima/papelera/${e.filename}`));
    papelera.forEach(e => {
      try {
        const f = path.join(PAPELERA_DIR, e.filename); if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch(e2) {}
    });
  }
  if (req.user.rol === 'superadmin') await dbPapeleraClear();
  else for (const e of papelera) await dbPapeleraDelete(e.id);
  res.json({ok:true});
});

// ═══════════════════════════════════════════════════════════════
// MÓDULO WOM
// ═══════════════════════════════════════════════════════════════
const DOCS_DIR_WOM      = path.join(__dirname, 'informes_wom');
const PAPELERA_DIR_WOM  = path.join(__dirname, 'papelera_wom');
const DB_FILE_WOM       = path.join(__dirname, 'registro_wom.json');
const PAPELERA_FILE_WOM = path.join(__dirname, 'papelera_wom.json');

if (!fs.existsSync(DOCS_DIR_WOM))      fs.mkdirSync(DOCS_DIR_WOM);
if (!fs.existsSync(PAPELERA_DIR_WOM))  fs.mkdirSync(PAPELERA_DIR_WOM);
if (!fs.existsSync(DB_FILE_WOM))       fs.writeFileSync(DB_FILE_WOM, '[]');
if (!fs.existsSync(PAPELERA_FILE_WOM)) fs.writeFileSync(PAPELERA_FILE_WOM, '[]');

// ── Local fallback helpers WOM ─────────────────────────────────
function loadDBWomLocal()        { try { return JSON.parse(fs.readFileSync(DB_FILE_WOM,'utf8')); }        catch { return []; } }
function saveDBWomLocal(d)       { fs.writeFileSync(DB_FILE_WOM, JSON.stringify(d, null, 2)); }
function loadPapeleraWomLocal()  { try { return JSON.parse(fs.readFileSync(PAPELERA_FILE_WOM,'utf8')); }  catch { return []; } }
function savePapeleraWomLocal(d) { fs.writeFileSync(PAPELERA_FILE_WOM, JSON.stringify(d, null, 2)); }

// ── Row mappers – WOM ──────────────────────────────────────────
const fromWom = r => ({
  id: r.id, fechaCreacion: r.fecha_creacion,
  ticket: r.ticket, codInterno: r.cod_interno,
  fechaInicio: r.fecha_inicio, instalacion: r.instalacion,
  tipoActividad: r.tipo_actividad, tecnicos: r.tecnicos,
  photoCount: r.photo_count, filename: r.filename,
  equipo: r.equipo || null,
  empresaId: r.empresa_id || null
});
const toWom = e => ({
  id: e.id, fecha_creacion: e.fechaCreacion,
  ticket: e.ticket, cod_interno: e.codInterno,
  fecha_inicio: e.fechaInicio, instalacion: e.instalacion,
  tipo_actividad: e.tipoActividad, tecnicos: e.tecnicos,
  photo_count: e.photoCount, filename: e.filename,
  equipo: e.equipo || null,
  empresa_id: e.empresaId || null
});

// ── Async DB – Informes WOM ────────────────────────────────────
async function dbWomList(q) {
  if (supabase) {
    let query = supabase.from('informes_wom')
      .select('*').order('fecha_creacion', { ascending: false });
    if (q) {
      const like = `%${escapeLike(q)}%`;
      query = query.or(
        `ticket.ilike.${like},cod_interno.ilike.${like},instalacion.ilike.${like}`
      );
    }
    const { data, error } = await query;
    if (!error) return (data||[]).map(fromWom);
    console.error('dbWomList:', error.message);
  }
  const db = loadDBWomLocal();
  if (!q) return db;
  const ql = q.toLowerCase();
  return db.filter(r => ['ticket','codInterno','instalacion','tipoActividad']
    .some(k => (r[k]||'').toLowerCase().includes(ql)));
}

async function dbWomInsert(entry) {
  if (supabase) {
    const { error } = await supabase.from('informes_wom').insert(toWom(entry));
    if (error) console.error('dbWomInsert:', error.message);
  } else {
    const db = loadDBWomLocal(); db.unshift(entry); saveDBWomLocal(db);
  }
}

async function dbWomFind(id) {
  if (supabase) {
    const { data, error } = await supabase.from('informes_wom')
      .select('*').eq('id', id).single();
    if (!error && data) return fromWom(data);
  }
  return loadDBWomLocal().find(r => r.id === id) || null;
}

async function dbWomDelete(id) {
  if (supabase) {
    const { error } = await supabase.from('informes_wom').delete().eq('id', id);
    if (error) console.error('dbWomDelete:', error.message);
  } else {
    saveDBWomLocal(loadDBWomLocal().filter(r => r.id !== id));
  }
}

// ── Async DB – Papelera WOM ────────────────────────────────────
async function dbPapeleraWomList() {
  if (supabase) {
    const { data, error } = await supabase.from('papelera_wom')
      .select('*').order('deleted_at', { ascending: false });
    if (!error) return (data||[]).map(r => ({ ...fromWom(r), deletedAt: r.deleted_at }));
    console.error('dbPapeleraWomList:', error.message);
  }
  return loadPapeleraWomLocal();
}

async function dbPapeleraWomInsert(entry) {
  if (supabase) {
    const { error } = await supabase.from('papelera_wom')
      .insert({ ...toWom(entry), deleted_at: entry.deletedAt });
    if (error) console.error('dbPapeleraWomInsert:', error.message);
  } else {
    const p = loadPapeleraWomLocal(); p.unshift(entry); savePapeleraWomLocal(p);
  }
}

async function dbPapeleraWomFind(id) {
  if (supabase) {
    const { data, error } = await supabase.from('papelera_wom')
      .select('*').eq('id', id).single();
    if (!error && data) return { ...fromWom(data), deletedAt: data.deleted_at };
  }
  return loadPapeleraWomLocal().find(r => r.id === id) || null;
}

async function dbPapeleraWomDelete(id) {
  if (supabase) {
    const { error } = await supabase.from('papelera_wom').delete().eq('id', id);
    if (error) console.error('dbPapeleraWomDelete:', error.message);
  } else {
    savePapeleraWomLocal(loadPapeleraWomLocal().filter(r => r.id !== id));
  }
}

async function dbPapeleraWomClear() {
  if (supabase) {
    const { error } = await supabase.from('papelera_wom').delete().neq('id', '');
    if (error) console.error('dbPapeleraWomClear:', error.message);
  } else {
    savePapeleraWomLocal([]);
  }
}

// ═══════════════════════════════════════════════════════════════
// PREVENTIVO INFORMES
// ═══════════════════════════════════════════════════════════════
const DOCS_DIR_PREV     = path.join(__dirname, 'informes_prev');
const PAPELERA_DIR_PREV = path.join(__dirname, 'papelera_prev');
const DB_FILE_PREV      = path.join(__dirname, 'registro_prev.json');
const PAPELERA_FILE_PREV = path.join(__dirname, 'papelera_prev.json');

if (!fs.existsSync(DOCS_DIR_PREV))      fs.mkdirSync(DOCS_DIR_PREV);
if (!fs.existsSync(PAPELERA_DIR_PREV))  fs.mkdirSync(PAPELERA_DIR_PREV);
if (!fs.existsSync(DB_FILE_PREV))       fs.writeFileSync(DB_FILE_PREV, '[]');
if (!fs.existsSync(PAPELERA_FILE_PREV)) fs.writeFileSync(PAPELERA_FILE_PREV, '[]');

function loadDBPrevLocal()        { try { return JSON.parse(fs.readFileSync(DB_FILE_PREV,'utf8')); }        catch { return []; } }
function saveDBPrevLocal(d)       { fs.writeFileSync(DB_FILE_PREV, JSON.stringify(d, null, 2)); }
function loadPapaleraPrevLocal()  { try { return JSON.parse(fs.readFileSync(PAPELERA_FILE_PREV,'utf8')); }  catch { return []; } }
function savePapaleraPrevLocal(d) { fs.writeFileSync(PAPELERA_FILE_PREV, JSON.stringify(d, null, 2)); }

const fromPrev = r => ({
  id: r.id, fechaCreacion: r.fecha_creacion,
  trackerId: r.tracker_id,
  nombreNodo: r.nombre_nodo, ejecutante: r.ejecutante,
  fecha: r.fecha, tareaOfficetrack: r.tarea_officetrack,
  equipoCount: r.equipo_count, tareaId: r.tarea_id, filename: r.filename,
  empresaId: r.empresa_id || null
});
const toPrev = e => ({
  id: e.id, fecha_creacion: e.fechaCreacion,
  tracker_id: e.trackerId,
  nombre_nodo: e.nombreNodo, ejecutante: e.ejecutante,
  fecha: e.fecha, tarea_officetrack: e.tareaOfficetrack,
  equipo_count: e.equipoCount, tarea_id: e.tareaId, filename: e.filename,
  empresa_id: e.empresaId || null
});

async function dbPrevList(q) {
  if (supabase) {
    let query = supabase.from('informes_prev')
      .select('*').order('fecha_creacion', { ascending: false });
    if (q) {
      const like = `%${escapeLike(q)}%`;
      query = query.or(`nombre_nodo.ilike.${like},ejecutante.ilike.${like}`);
    }
    const { data, error } = await query;
    if (!error) return (data||[]).map(fromPrev);
    console.error('dbPrevList:', error.message);
  }
  const db = loadDBPrevLocal();
  if (!q) return db;
  const ql = q.toLowerCase();
  return db.filter(r => ['nombreNodo','ejecutante','tareaOfficetrack']
    .some(k => (r[k]||'').toLowerCase().includes(ql)));
}
async function dbPrevInsert(entry) {
  if (supabase) {
    const { error } = await supabase.from('informes_prev').insert(toPrev(entry));
    if (error) console.error('dbPrevInsert:', error.message);
  } else {
    const db = loadDBPrevLocal(); db.unshift(entry); saveDBPrevLocal(db);
  }
}
async function dbPrevFind(id) {
  if (supabase) {
    const { data, error } = await supabase.from('informes_prev')
      .select('*').eq('id', id).single();
    if (!error && data) return fromPrev(data);
  }
  return loadDBPrevLocal().find(r => r.id === id) || null;
}
async function dbPrevFindBySecId(secId) {
  if (supabase) {
    const { data, error } = await supabase.from('informes_prev')
      .select('*').eq('tarea_officetrack', secId).single();
    if (!error && data) return fromPrev(data);
  }
  return loadDBPrevLocal().find(r => r.tareaOfficetrack === secId) || null;
}
async function dbPrevDelete(id) {
  if (supabase) {
    const { error } = await supabase.from('informes_prev').delete().eq('id', id);
    if (error) console.error('dbPrevDelete:', error.message);
  } else {
    saveDBPrevLocal(loadDBPrevLocal().filter(r => r.id !== id));
  }
}
async function dbPapaleraPrevInsert(entry) {
  if (supabase) {
    const { error } = await supabase.from('papelera_prev')
      .insert({ ...toPrev(entry), deleted_at: entry.deletedAt });
    if (error) console.error('dbPapaleraPrevInsert:', error.message);
  } else {
    const p = loadPapaleraPrevLocal(); p.unshift(entry); savePapaleraPrevLocal(p);
  }
}

// ── Sitios Preventivos (Excel lookup) ─────────────────────────
// Acepta el nombre histórico o la planilla real "SITIOS.xlsx" del usuario.
const SITIOS_XLSX   = [
  path.join(__dirname, 'sitios_preventivos.xlsx'),
  path.join(__dirname, 'SITIOS.xlsx')
].find(p => fs.existsSync(p)) || path.join(__dirname, 'SITIOS.xlsx');
const TRACKER_FILE  = path.join(__dirname, 'tracker_prev.json');

if (!fs.existsSync(TRACKER_FILE)) fs.writeFileSync(TRACKER_FILE, JSON.stringify({last:0}));

function loadSitiosPrev() {
  try {
    const XLSX = require('xlsx');
    const wb   = XLSX.readFile(SITIOS_XLSX);
    // Preferir una hoja llamada "Sitios"; si no, la primera.
    const sheetName = wb.SheetNames.find(n => /sitio/i.test(n)) || wb.SheetNames[0];
    const ws   = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, {header:1});
    if (!rows.length) return [];
    // Detectar columnas por encabezado: tolera distintos formatos de planilla
    // (ej. "SITIOS.xlsx" con solo Centrales + Dirección).
    const headers = (rows[0]||[]).map(h => (h||'').toString().trim().toLowerCase());
    const col      = (...keys) => headers.findIndex(h => keys.some(k => h.includes(k)));
    const colExact = (...keys) => headers.findIndex(h => keys.includes(h));
    let iNombre = col('sitio','central','nodo','hub','nombre');
    let iDir    = col('direcc');
    const iCasa   = col('casa');                       // "Número de casa" se anexa a la dirección
    const iComuna = col('comuna','ciudad');
    const iCrit   = col('criticidad');
    let iCat      = colExact('categoría','categoria'); // exacto: evita "Categorías" (plural)
    if (iCat < 0) iCat = col('categor');
    const iCod    = col('punto de inter','código','codigo');
    if (iNombre < 0) iNombre = 0;
    if (iDir    < 0) iDir = 1;
    return rows.slice(1)
      .map(r => ({
        nombre:     (r[iNombre]||'').toString().trim(),
        direccion:  [(r[iDir]||'').toString().trim(), iCasa >= 0 ? (r[iCasa]||'').toString().trim() : '']
                      .filter(Boolean).join(' ').trim(),
        ciudad:     iComuna >= 0 ? (r[iComuna]||'').toString().trim() : '',
        criticidad: iCrit   >= 0 ? (r[iCrit]||'').toString().trim()   : '',
        categoria:  iCat    >= 0 ? (r[iCat]||'').toString().trim()    : '',
        codigo:     iCod    >= 0 ? (r[iCod]||'').toString().trim()    : ''
      }))
      .filter(s => s.nombre);
  } catch(e) {
    console.error('loadSitiosPrev:', e.message);
    return [];
  }
}
let sitiosPrevData = loadSitiosPrev();

// Persiste el catálogo de sitios al .xlsx (mismo formato que lee loadSitiosPrev).
function saveSitiosPrev(arr) {
  const XLSX = require('xlsx');
  const header = ['Sitio', 'Dirección', 'Comuna', 'Criticidad', 'Categoría', 'Código'];
  const aoa = [header, ...arr.map(s => [
    s.nombre || '', s.direccion || '', s.ciudad || '',
    s.criticidad || '', s.categoria || '', s.codigo || ''
  ])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sitios');
  XLSX.writeFile(wb, SITIOS_XLSX);
}

// Clave de duplicado: mismo nombre + dirección + comuna (normalizados).
const sitioKey = s => ['nombre', 'direccion', 'ciudad']
  .map(k => (s[k] || '').toString().trim().toLowerCase().replace(/\s+/g, ' '))
  .join('|');

function nextTrackerId() {
  let counter = 0;
  try { counter = JSON.parse(fs.readFileSync(TRACKER_FILE,'utf8')).last || 0; } catch{}
  counter++;
  fs.writeFileSync(TRACKER_FILE, JSON.stringify({last:counter}));
  return String(counter).padStart(3,'0');
}
function peekTrackerId() {
  let counter = 0;
  try { counter = JSON.parse(fs.readFileSync(TRACKER_FILE,'utf8')).last || 0; } catch{}
  return String(counter + 1).padStart(3,'0');
}

const RSO_SITES = {
  'RSO CONCEPCION':   'ANIBAL PINTO 105, CONCEPCION',
  'RSO ANTOFAGASTA':  'FELIX GARCIA 581, ANTOFAGASTA',
  'RSO PUERTO MONTT': 'AV LO CELIS S/N PUERTO MONTT',
  'RSO PUNTA ARENAS': 'AV PDTE EDUARDO FREI MONTALVA 5, PUNTA ARENAS'
};

const ACTIVIDADES_WOM = [
  'Trabajo Correctivo',
  'Mantenimiento preventivo',
  'Atención de emergencia',
  'Inspección',
  'Retiro de equipos'
];

async function buildDocxWom(d) {
  const v  = s => (s||'').toString().trim();

  // ── Medidas exactas del documento de referencia ──────────
  // Header: tabla exterior invisible, col izq (logos) + col der (ORDEN DE TRABAJO)
  const HDR_L   = 5616;   // col izquierda header (logos)
  const HDR_R   = 5020;   // col derecha header (ORDEN DE TRABAJO = 2×2510)
  const OT_COL  = 2510;   // columnas dentro de la mini-tabla OT

  // Cuerpo: 9 tablas independientes
  const LBL_W   = 1911;   // etiqueta azul (body)
  const VAL_W   = 8453;   // valor (body)
  const FULL_W  = LBL_W + VAL_W;   // 10364
  const TEC_W   = 5067;             // técnicos (media página)
  const DAT_LBL = 1199;
  const DAT_VAL = 9165;
  const RES_L   = 5171;   // resumen col izq
  const RES_R   = 5245;   // resumen col der (exacto del ref: 5171+5245=10416)
  const RES_W   = RES_L + RES_R;   // 10416

  // ── Colores ──────────────────────────────────────────────
  const BLU = '1F497D';
  const WHT = 'FFFFFF';
  const GRN = '008000';
  const BLK = '000000';

  // ── Bordes ───────────────────────────────────────────────
  const thin    = () => ({ style: BorderStyle.SINGLE, size: 4, color: 'auto' });
  const noneB   = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  // Blanco en vez de "none": Word/docx-preview muestran una linea guia (gridline)
  // para celdas sin ningun borde definido. Con un borde blanco real, nunca se ve.
  const whiteB  = () => ({ style: BorderStyle.SINGLE, size: 4, color: 'FFFFFF' });
  const brd     = { top:thin(), bottom:thin(), left:thin(), right:thin() };
  const tblBrd  = { top:thin(), bottom:thin(), left:thin(), right:thin(), insideH:thin(), insideV:thin() };
  const noBrd   = { top:whiteB(), bottom:whiteB(), left:whiteB(), right:whiteB() };
  const noTblBrd= { top:whiteB(), bottom:whiteB(), left:whiteB(), right:whiteB(), insideH:whiteB(), insideV:whiteB() };
  // La mini-tabla OT va anidada dentro de una celda del header con otra celda
  // (logos) más alta a su lado: docx-preview estira el borde izquierdo de la
  // tabla anidada hasta el alto de la fila completa. Sin borde izquierdo aquí
  // evita esa línea larga; el resto de tablas del cuerpo no están anidadas y sí
  // llevan los 4 bordes.
  const otBrd    = { top:thin(), bottom:thin(), left:noneB, right:thin() };
  const otTblBrdX= { top:thin(), bottom:thin(), left:noneB, right:thin(), insideH:thin(), insideV:thin() };

  // ── Helpers ──────────────────────────────────────────────
  const para = (children, align='left', before=0) => new Paragraph({
    alignment: align==='center' ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before, after: 0 },
    children: Array.isArray(children) ? children : [children]
  });
  const run = (text, opts={}) => new TextRun({
    text: text||'', size: opts.sz||18, font: 'Calibri',
    bold: !!opts.bold, italics: !!opts.it, color: opts.c||BLK
  });

  // Celda OT (texto centrado, sin relleno)
  const otCell = (text, w, opts={}) => new TableCell({
    width:{size:w,type:WidthType.DXA}, borders:otBrd,
    verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:14,right:14},
    children:[para(run(text,opts),'center',110)]
  });
  // Celda OT azul (ORDEN DE TRABAJO / Fecha OT)
  const otBlu = (text, w, span, sz) => new TableCell({
    width:{size:w,type:WidthType.DXA}, ...(span>1?{columnSpan:span}:{}),
    borders:otBrd, shading:{fill:BLU,type:ShadingType.CLEAR},
    verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:60,right:60},
    children:[para(run(text,{bold:true,sz,c:WHT}),'center',sz===30?284:110)]
  });
  // Celda código interno verde centrada
  const otCod = (codVal, w) => new TableCell({
    width:{size:w,type:WidthType.DXA}, borders:otBrd,
    verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:14,right:14},
    children:[para(codVal
      ? run(`INC-${codVal}`,{bold:true,c:GRN,sz:18})
      : run('',{sz:18}),
    'center',110)]
  });

  // Mini-tabla ORDEN DE TRABAJO — anidada, sin borde izquierdo (ver otBrd)
  const otTblBrd = otTblBrdX;
  const otTable = new Table({
    width:{size:HDR_R,type:WidthType.DXA}, columnWidths:[OT_COL,OT_COL], borders:otTblBrd,
    indent:{size:0,type:WidthType.DXA},
    rows:[
      // Alturas medidas en pixeles exactos del PDF de referencia (informe 1)
      // a 96dpi (1px = 15 twips): 45,31,32,30,30,29 px de alto por fila.
      new TableRow({height:{value:675},children:[otBlu('ORDEN DE TRABAJO',OT_COL*2,2,30)]}),
      new TableRow({height:{value:465},children:[
        otCell('Código Interno',OT_COL), otCod(v(d.codInterno),OT_COL)
      ]}),
      new TableRow({height:{value:480},children:[
        otCell('Ticket',OT_COL), otCell(v(d.ticket),OT_COL,{bold:true})
      ]}),
      new TableRow({height:{value:450},children:[otBlu('Fecha OT',OT_COL*2,2,18)]}),
      new TableRow({height:{value:450},children:[
        otCell('Inicio:',OT_COL), otCell(`${v(d.fechaInicio)}  ${v(d.horaInicio)}`,OT_COL)
      ]}),
      new TableRow({height:{value:435},children:[
        otCell('Término:',OT_COL), otCell(`${v(d.fechaTermino)}  ${v(d.horaTermino)}`,OT_COL)
      ]})
    ]
  });

  // ── Logos (ICETEL + WOM) ──────────────────────────────────
  let icetelLogo = null, womLogo = null;
  try { const p=path.join(__dirname,'icetel-logo.jpeg'); if(fs.existsSync(p)) icetelLogo=fs.readFileSync(p); } catch(e){}
  try { const p=path.join(__dirname,'wom-logo.png');     if(fs.existsSync(p)) womLogo   =fs.readFileSync(p); } catch(e){}

  const logoParas = [];
  if (icetelLogo) logoParas.push(
    para(new ImageRun({data:icetelLogo, transformation:{width:314,height:175}}), 'left', 0)
  );
  if (womLogo) logoParas.push(
    new Paragraph({
      spacing:{before:40,after:0},
      indent:{left:420},
      children:[new ImageRun({data:womLogo, transformation:{width:220,height:102}})]
    })
  );
  if (!logoParas.length) logoParas.push(para(run('ICETEL / WOM',{bold:true,sz:20}),'left',0));

  // Celda logos (col izq header, sin bordes)
  const logoCell = new TableCell({
    width:{size:HDR_L,type:WidthType.DXA}, borders:noBrd,
    verticalAlign:VerticalAlign.TOP, margins:{top:40,bottom:40,left:0,right:40},
    children:logoParas
  });

  // Celda derecha header: contiene la mini-tabla OT
  const otCell_ = new TableCell({
    width:{size:HDR_R,type:WidthType.DXA}, borders:noBrd,
    verticalAlign:VerticalAlign.TOP, margins:{top:0,bottom:0,left:0,right:0},
    children:[otTable]
  });

  // Tabla exterior header (invisible)
  const hdrTable = new Table({
    width:{size:HDR_L+HDR_R,type:WidthType.DXA},
    columnWidths:[HDR_L,HDR_R],
    borders:noTblBrd,
    rows:[new TableRow({children:[logoCell, otCell_]})]
  });

  // ── Helpers para tablas de cuerpo ────────────────────────
  const bluCell = (text, w, span=1) => new TableCell({
    width:{size:w,type:WidthType.DXA}, ...(span>1?{columnSpan:span}:{}),
    borders:brd, shading:{fill:BLU,type:ShadingType.CLEAR},
    verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:100,right:80},
    children:[para(run(text,{bold:true,sz:18,c:WHT}))]
  });
  const valCell = (text, w, opts={}) => new TableCell({
    width:{size:w,type:WidthType.DXA}, borders:brd,
    verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:100,right:60},
    children:[para(run(text,{sz:18,bold:opts.bold||false,c:opts.c||BLK}))]
  });
  const whtCell = (text, w) => new TableCell({
    width:{size:w,type:WidthType.DXA}, borders:brd,
    shading:{fill:WHT,type:ShadingType.CLEAR},
    verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:100,right:60},
    children:[para(run(text,{bold:true}))]
  });
  const multiCell = (paragraphs, w) => new TableCell({
    width:{size:w,type:WidthType.DXA}, borders:brd,
    margins:{top:60,bottom:60,left:100,right:80}, children:paragraphs
  });

  // ── TABLE 2: Cliente/Sistemas/Tipo actividad/Sitio/Dirección ─
  const bodyTable = new Table({
    width:{size:FULL_W,type:WidthType.DXA}, columnWidths:[LBL_W,VAL_W], borders:tblBrd,
    rows:[
      new TableRow({height:{value:404},children:[bluCell('Cliente',LBL_W),        valCell('WOM',VAL_W,{bold:true})]}),
      new TableRow({height:{value:404},children:[bluCell('Sistemas',LBL_W),        valCell(v(d.infraestructura),VAL_W)]}),
      new TableRow({height:{value:404},children:[bluCell('Tipo de actividad',LBL_W),valCell(v(d.tipoActividad),VAL_W)]}),
      new TableRow({height:{value:404},children:[bluCell('Instalación',LBL_W),     valCell(v(d.instalacion),VAL_W)]}),
      new TableRow({height:{value:404},children:[bluCell('Dirección',LBL_W),       valCell(v(d.direccion),VAL_W)]})
    ]
  });

  // ── TABLE 3: Trabajos Realizados ──────────────────────────
  const trabajosParas = (v(d.trabajos)||'').split('\n').filter(l=>l.trim())
    .map(line => new Paragraph({spacing:{before:0,after:60},children:[run(line.trim())]}));
  if (!trabajosParas.length) trabajosParas.push(new Paragraph({spacing:{before:0,after:0},children:[run('')]}));
  const trabajosTable = new Table({
    width:{size:FULL_W,type:WidthType.DXA}, columnWidths:[FULL_W], borders:tblBrd,
    rows:[
      new TableRow({height:{value:404},children:[bluCell('Trabajos Realizados',FULL_W)]}),
      new TableRow({height:{value:Math.max(608,trabajosParas.length*300)},children:[multiCell(trabajosParas,FULL_W)]})
    ]
  });

  // ── TABLE 4: Observaciones ────────────────────────────────
  const obsTable = new Table({
    width:{size:FULL_W,type:WidthType.DXA}, columnWidths:[FULL_W], borders:tblBrd,
    rows:[
      new TableRow({height:{value:404},children:[bluCell('Observaciones',FULL_W)]}),
      new TableRow({height:{value:404},children:[multiCell(
        [para(run(v(d.observaciones)||'Sin observaciones adicionales'))], FULL_W
      )]})
    ]
  });

  // ── TABLE 5: Separador vacío ──────────────────────────────
  const emptyTable = new Table({
    width:{size:FULL_W,type:WidthType.DXA}, columnWidths:[FULL_W], borders:noTblBrd,
    rows:[new TableRow({height:{value:150},children:[
      new TableCell({width:{size:FULL_W,type:WidthType.DXA},borders:noBrd,children:[para(run(''))]})
    ]})]
  });

  // ── TABLE 6: Técnicos (5067 DXA) ─────────────────────────
  const tecNames = (d.tecnicos||[]).filter(Boolean);
  const tecTable = new Table({
    width:{size:TEC_W,type:WidthType.DXA}, columnWidths:[TEC_W], borders:tblBrd,
    rows:[
      new TableRow({height:{value:404},children:[bluCell('Técnico(s) Responsable(s)',TEC_W)]}),
      new TableRow({height:{value:404},children:[new TableCell({
        width:{size:TEC_W,type:WidthType.DXA}, borders:brd,
        verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:100,right:60},
        children:[para([run('Nombre y Apellido:  ',{bold:true}), run(tecNames.join('    /    '))])]
      })]})
    ]
  });

  // ── TABLE 7: Datos Generales (1199|9165) ─────────────────
  const datTable = new Table({
    width:{size:FULL_W,type:WidthType.DXA}, columnWidths:[DAT_LBL,DAT_VAL], borders:tblBrd,
    rows:[
      new TableRow({height:{value:404},children:[
        new TableCell({width:{size:FULL_W,type:WidthType.DXA},columnSpan:2,borders:brd,
          shading:{fill:BLU,type:ShadingType.CLEAR},verticalAlign:VerticalAlign.CENTER,
          margins:{top:40,bottom:40,left:100,right:80},
          children:[para(run('Datos generales:',{bold:true,c:WHT}))]})
      ]}),
      new TableRow({height:{value:404},children:[whtCell('Sala:',DAT_LBL),   valCell(v(d.sala),DAT_VAL)]}),
      new TableRow({height:{value:404},children:[whtCell('Equipo:',DAT_LBL), valCell(v(d.equipo),DAT_VAL)]}),
      new TableRow({height:{value:404},children:[whtCell('Marca:',DAT_LBL),  valCell(v(d.marca),DAT_VAL)]}),
      new TableRow({height:{value:404},children:[whtCell('Modelo:',DAT_LBL), valCell(v(d.modelo),DAT_VAL)]})
    ]
  });

  // ── TABLE 8: Resumen + Fotos (5171|5245 = 10416) ─────────
  const photos   = d.photos   || [];
  const captions = d.captions || [];

  const mkPhotoCell = (b64, w) => {
    if (!b64) return new TableCell({width:{size:w,type:WidthType.DXA},borders:brd,
      verticalAlign:VerticalAlign.CENTER,margins:{top:40,bottom:40,left:40,right:40},
      children:[para(run(''))]});
    try {
      const buf = Buffer.from(b64.replace(/^data:image\/\w+;base64,/,''),'base64');
      return new TableCell({width:{size:w,type:WidthType.DXA},borders:brd,
        verticalAlign:VerticalAlign.CENTER,margins:{top:40,bottom:40,left:40,right:40},
        children:[para(new ImageRun({data:buf,transformation:{width:235,height:175}}),'center')]});
    } catch(e) {
      return new TableCell({width:{size:w,type:WidthType.DXA},borders:brd,
        children:[para(run('[error foto]',{sz:14}))]});
    }
  };
  const mkCapCell = (idx, w) => new TableCell({
    width:{size:w,type:WidthType.DXA},borders:brd,
    verticalAlign:VerticalAlign.CENTER,margins:{top:30,bottom:30,left:100,right:60},
    children:[para(run(captions[idx]||'',{sz:16,it:true}))]
  });

  const resRows = [
    new TableRow({height:{value:394},children:[
      new TableCell({width:{size:RES_W,type:WidthType.DXA},columnSpan:2,borders:brd,
        shading:{fill:BLU,type:ShadingType.CLEAR},verticalAlign:VerticalAlign.CENTER,
        margins:{top:40,bottom:40,left:100,right:80},
        children:[para(run('RESUMEN DE ACTIVIDAD:',{bold:true,c:WHT}))]})
    ]}),
    new TableRow({height:{value:414},children:[
      new TableCell({width:{size:RES_L,type:WidthType.DXA},borders:brd,
        margins:{top:40,bottom:40,left:100,right:60},children:[para(run(v(d.resumen1)))]}),
      new TableCell({width:{size:RES_R,type:WidthType.DXA},borders:brd,
        margins:{top:40,bottom:40,left:100,right:60},children:[para(run(v(d.resumen2)))]})
    ]})
  ];

  for (let i=0; i<Math.min(photos.length,8); i+=2) {
    const ph = i===0 ? 3231 : 3826;
    resRows.push(new TableRow({height:{value:ph},children:[
      mkPhotoCell(photos[i]||null,RES_L), mkPhotoCell(photos[i+1]||null,RES_R)
    ]}));
    resRows.push(new TableRow({height:{value:458},children:[
      mkCapCell(i,RES_L), mkCapCell(i+1,RES_R)
    ]}));
  }

  const resTable = new Table({
    width:{size:RES_W,type:WidthType.DXA}, columnWidths:[RES_L,RES_R], borders:tblBrd, rows:resRows
  });

  // ── Documento final ───────────────────────────────────────
  const gap = new Paragraph({spacing:{before:0,after:60},children:[]});
  const doc = new Document({
    sections:[{
      properties:{
        page:{
          margin:{top:720,right:708,bottom:280,left:566},
          size:{width:12240,height:15840}
        }
      },
      children:[
        hdrTable, gap,
        bodyTable, gap,
        trabajosTable, gap,
        obsTable, gap,
        emptyTable, gap,
        tecTable, gap,
        datTable, gap,
        resTable
      ]
    }]
  });
  return await Packer.toBuffer(doc);
}

// ── WOM Routes ─────────────────────────────────────────────────
app.get('/sitios-rso', (_req, res) => res.json(RSO_SITES));
app.get('/actividades-wom', (_req, res) => res.json(ACTIVIDADES_WOM));

app.post('/generar-wom', authMiddleware, requireModulo('wom'), async (req, res) => {
  try {
    const d = req.body;
    const buffer = await buildDocxWom(d);
    const ticket = (d.ticket||'WOM').replace(/[^a-zA-Z0-9\-_]/g,'_').slice(0,50);
    const fname  = `${ticket}_WOM.docx`;
    fs.writeFileSync(path.join(DOCS_DIR_WOM, fname), buffer);
    await storageUpload(buffer, `wom/${fname}`);

    const { photos, captions } = d;
    const entry = {
      id: Date.now().toString(),
      fechaCreacion: new Date().toISOString(),
      ticket: d.ticket, codInterno: d.codInterno,
      fechaInicio: d.fechaInicio, instalacion: d.instalacion,
      tipoActividad: d.tipoActividad,
      equipo: d.equipo || null,
      tecnicos: (d.tecnicos||[]).filter(Boolean).join(', '),
      photoCount: (photos||[]).filter(Boolean).length,
      filename: fname,
      empresaId: req.user.empresa_id || null
    };
    await dbWomInsert(entry);

    // Hoja de vida: registra/actualiza el equipo. Nunca rompe la generación.
    try {
      await equiposDb.upsertDesdeInforme({
        empresaId: req.user.empresa_id || null,
        sitio: d.instalacion, numero: d.equipo,
        marca: d.marca, modelo: d.modelo,
        fecha: d.fechaInicio
      });
    } catch (e) { console.error('equipos upsert (wom):', e.message); }
    // Informe de gestión asignado al técnico → marcar generado + enlazar doc.
    await vincularInformeGestion(req, d.gestionInformeId, `/descargar-wom/${entry.id}`, fname);

    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition',`attachment; filename="${fname}"`);
    res.setHeader('Access-Control-Expose-Headers','Content-Disposition');
    res.send(buffer);
  } catch(err) { console.error(err); res.status(500).json({error:err.message}); }
});

app.get('/registro-wom', authMiddleware, requireModulo('wom'), async (req, res) => {
  const q = sanitizeSearch(req.query.q);
  res.json(filtrarInformesPorEmpresa(await dbWomList(q), req.user));
});

app.get('/descargar-wom/:id', authMiddleware, requireModulo('wom'), async (req, res) => {
  const entry = await dbWomFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  let buffer = await storageDownload(`wom/${entry.filename}`);
  if (!buffer) {
    const fpath = path.join(DOCS_DIR_WOM, entry.filename);
    if (!fs.existsSync(fpath)) return res.status(404).json({error:'Archivo no encontrado'});
    buffer = fs.readFileSync(fpath);
  }
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition',`attachment; filename="${entry.filename}"`);
  res.send(buffer);
});


app.delete('/registro-wom/:id', authMiddleware, requireModulo('wom'), async (req, res) => {
  const entry = await dbWomFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  await storageMove(`wom/${entry.filename}`, `wom/papelera/${entry.filename}`);
  try {
    const fp = path.join(DOCS_DIR_WOM, entry.filename);
    if (fs.existsSync(fp)) fs.renameSync(fp, path.join(PAPELERA_DIR_WOM, entry.filename));
  } catch(e) {}
  await dbWomDelete(entry.id);
  await dbPapeleraWomInsert({ ...entry, deletedAt: new Date().toISOString() });
  res.json({ok:true});
});

// ── Sitios / Tracker API ────────────────────────────────────────
app.get('/api/sitios-preventivos', authMiddleware, (_req, res) => {
  res.json(sitiosPrevData);
});
app.post('/api/sitios-preventivos/reload', authMiddleware, requireNivel(3), (_req, res) => {
  sitiosPrevData = loadSitiosPrev();
  res.json({ ok: true, count: sitiosPrevData.length });
});
app.post('/api/sitios-preventivos/upload', authMiddleware, requireNivel(3), (req, res) => {
  try {
    const { dataBase64 } = req.body;
    if (!dataBase64) return res.status(400).json({ error: 'dataBase64 requerido' });
    const buf = Buffer.from(dataBase64, 'base64');
    fs.writeFileSync(SITIOS_XLSX, buf);
    sitiosPrevData = loadSitiosPrev();
    res.json({ ok: true, count: sitiosPrevData.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// Alta individual de un sitio. 409 si ya existe uno con la misma información.
app.post('/api/sitios-preventivos', authMiddleware, requireNivel(3), (req, res) => {
  try {
    const b = req.body || {};
    const nombre = (b.nombre || '').toString().trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre del sitio es obligatorio' });
    const nuevo = {
      nombre,
      direccion: (b.direccion || '').toString().trim(),
      ciudad: (b.ciudad || b.comuna || '').toString().trim(),
      criticidad: (b.criticidad || '').toString().trim(),
      categoria: (b.categoria || '').toString().trim(),
      codigo: (b.codigo || '').toString().trim()
    };
    const existente = sitiosPrevData.find(s => sitioKey(s) === sitioKey(nuevo));
    if (existente) return res.status(409).json({ error: 'Ya existe un sitio con la misma información', existente });
    sitiosPrevData.push(nuevo);
    saveSitiosPrev(sitiosPrevData);
    res.json({ ok: true, sitio: nuevo, count: sitiosPrevData.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Carga masiva: AÑADE (no reemplaza). Inserta los no repetidos y devuelve
// los duplicados (nuevo vs existente) para que el usuario elija cuál dejar.
app.post('/api/sitios-preventivos/importar', authMiddleware, requireNivel(3), (req, res) => {
  try {
    const { dataBase64 } = req.body || {};
    if (!dataBase64) return res.status(400).json({ error: 'dataBase64 requerido' });
    const XLSX = require('xlsx');
    const wb = XLSX.read(Buffer.from(dataBase64, 'base64'), { type: 'buffer' });
    const sheetName = wb.SheetNames.find(n => /sitio/i.test(n)) || wb.SheetNames[0];
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
    const pick = (f, ...keys) => {
      for (const k of Object.keys(f)) {
        const lk = k.trim().toLowerCase();
        if (keys.some(x => lk.includes(x))) { const v = String(f[k] ?? '').trim(); if (v) return v; }
      }
      return '';
    };
    const nuevos = filas.map(f => ({
      nombre: pick(f, 'sitio', 'central', 'nodo', 'hub', 'nombre'),
      direccion: pick(f, 'direcc'),
      ciudad: pick(f, 'comuna', 'ciudad'),
      criticidad: pick(f, 'criticidad'),
      categoria: pick(f, 'categor'),
      codigo: pick(f, 'código', 'codigo', 'punto de inter')
    })).filter(s => s.nombre);

    const agregados = [], duplicados = [];
    const vistos = new Map(sitiosPrevData.map(s => [sitioKey(s), s]));
    for (const s of nuevos) {
      const k = sitioKey(s);
      const prev = vistos.get(k);
      if (prev) { duplicados.push({ nuevo: s, existente: prev }); }
      else { vistos.set(k, s); sitiosPrevData.push(s); agregados.push(s); }
    }
    if (agregados.length) saveSitiosPrev(sitiosPrevData);
    res.json({ ok: true, total: nuevos.length, agregados: agregados.length, duplicados, count: sitiosPrevData.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Resolver duplicados: reemplaza el sitio existente por la versión nueva elegida.
app.post('/api/sitios-preventivos/resolver', authMiddleware, requireNivel(3), (req, res) => {
  try {
    const { decisiones } = req.body || {};
    if (!Array.isArray(decisiones)) return res.status(400).json({ error: 'decisiones requerido' });
    let reemplazados = 0;
    for (const d of decisiones) {
      if (d.accion !== 'reemplazar' || !d.nuevo) continue;
      const k = sitioKey(d.nuevo);
      const idx = sitiosPrevData.findIndex(s => sitioKey(s) === k);
      if (idx >= 0) { sitiosPrevData[idx] = { ...sitiosPrevData[idx], ...d.nuevo }; reemplazados++; }
    }
    if (reemplazados) saveSitiosPrev(sitiosPrevData);
    res.json({ ok: true, reemplazados, count: sitiosPrevData.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/preview-tracker', authMiddleware, (_req, res) => {
  res.json({ next: peekTrackerId() });
});

// ── Preventivo Informe routes ───────────────────────────────────
app.post('/generar-preventivo', authMiddleware, requireModulo('preventivo'), async (req, res) => {
  try {
    const d = req.body;
    const trackerId = nextTrackerId();
    d.trackerId = trackerId;
    // QR para el PDF
    try {
      const QRCode = require('qrcode');
      const verUrl = `${req.protocol}://${req.get('host')}/verificar-informe?id=${encodeURIComponent(d.tareaOfficetrack||'')}`;
      d.qrDataUrl = await QRCode.toDataURL(verUrl, { width: 80, margin: 1, color: { dark: '#0F172A', light: '#ffffff' } });
    } catch(e) { d.qrDataUrl = null; }
    const buffer = await buildPdfPreventivo(d);

    // Nombre: SITIO_CRQ_SALA.pdf
    const sitio = (d.nombreNodo||'SITIO').replace(/[^a-zA-Z0-9\-]/g,'_').replace(/_+/g,'_').slice(0,35);
    const crq   = (d.crq||trackerId).replace(/[^a-zA-Z0-9\-]/g,'_').slice(0,20);
    const sala  = (d.sala||'').replace(/[^a-zA-Z0-9]/g,'_').slice(0,6);
    const fname = `${sitio}_${crq}_${sala}.pdf`;

    fs.writeFileSync(path.join(DOCS_DIR_PREV, fname), buffer);
    await storageUpload(buffer, `prev/${fname}`);

    const entry = {
      id: Date.now().toString(),
      fechaCreacion: new Date().toISOString(),
      trackerId,
      nombreNodo: d.nombreNodo, ejecutante: d.ejecutante,
      fecha: d.fecha, tareaOfficetrack: d.tareaOfficetrack,
      equipoCount: (d.equipos||[]).length,
      tareaId: d.tareaId||null, filename: fname,
      empresaId: req.user.empresa_id || null
    };
    await dbPrevInsert(entry);

    if (d.tareaId) {
      const mapFile = path.join(__dirname, 'tareas_informes.json');
      let map = {};
      try { map = JSON.parse(fs.readFileSync(mapFile,'utf8')); } catch{}
      map[d.tareaId] = { informeId: entry.id, filename: fname, tipo: 'prev' };
      fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
    }
    // Informe de gestión asignado al técnico → marcar generado + enlazar doc.
    await vincularInformeGestion(req, d.gestionInformeId, `/descargar-prev/${entry.id}`, fname);

    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${fname}"`);
    res.setHeader('Access-Control-Expose-Headers','Content-Disposition');
    res.send(buffer);
  } catch(err) { console.error(err); res.status(500).json({error:err.message}); }
});

// ── Verificación pública de informe preventivo (sin auth) ─────
app.get('/verificar-informe', async (req, res) => {
  const id = (req.query.id||'').trim();
  if (!id) return res.status(400).send('<h2>ID no proporcionado</h2>');
  const entry = await dbPrevFindBySecId(id);
  const found = !!entry;
  const color = found ? '#059669' : '#DC2626';
  const icon  = found ? '✅' : '❌';
  const title = found ? 'Informe Verificado' : 'ID No Encontrado';
  const body  = found ? `
    <div class="row"><span class="lbl">Sitio</span><span>${escapeHtml(entry.nombreNodo||'—')}</span></div>
    <div class="row"><span class="lbl">Técnico</span><span>${escapeHtml(entry.ejecutante||'—')}</span></div>
    <div class="row"><span class="lbl">Fecha</span><span>${escapeHtml(entry.fecha||'—')}</span></div>
    <div class="row"><span class="lbl">Equipos</span><span>${escapeHtml(entry.equipoCount||'—')}</span></div>
    <div class="row"><span class="lbl">Generado</span><span>${escapeHtml(entry.fechaCreacion ? new Date(entry.fechaCreacion).toLocaleString('es-CL') : '—')}</span></div>
  ` : `<p style="color:#64748B;font-size:.9rem">El ID de seguridad <strong>${escapeHtml(id)}</strong> no corresponde a ningún informe registrado.</p>`;

  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} – ICETEL</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#F0F4F9;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:1rem}
    .card{background:#fff;border-radius:24px;padding:2.5rem 2rem;max-width:420px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.1)}
    .icon{font-size:3rem;margin-bottom:.75rem}
    h1{font-size:1.25rem;font-weight:800;color:${color};margin-bottom:.5rem}
    .sec-id{font-family:monospace;font-size:.85rem;background:#F8FAFC;border:1px solid rgba(0,0,0,.08);border-radius:8px;padding:.4rem .8rem;display:inline-block;margin-bottom:1.25rem;color:#475569;letter-spacing:.04em}
    .rows{text-align:left;border-top:1px solid #F1F5F9;padding-top:1rem;display:flex;flex-direction:column;gap:.6rem}
    .row{display:flex;justify-content:space-between;gap:.5rem;font-size:.875rem}
    .lbl{color:#94A3B8;font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;padding-top:2px}
    .footer{margin-top:1.5rem;font-size:.72rem;color:#CBD5E1}
  </style></head><body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <div class="sec-id">${escapeHtml(id)}</div>
    <div class="rows">${body}</div>
    <div class="footer">ICETEL · Sistema de Informes de Mantenimiento Clima</div>
  </div>
  </body></html>`);
});

app.get('/registro-prev', authMiddleware, requireModulo('preventivo'), async (req, res) => {
  const q = sanitizeSearch(req.query.q);
  res.json(filtrarInformesPorEmpresa(await dbPrevList(q), req.user));
});

app.get('/descargar-prev/:id', authMiddleware, requireModulo('preventivo'), async (req, res) => {
  const entry = await dbPrevFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  let buffer = await storageDownload(`prev/${entry.filename}`);
  if (!buffer) {
    const fpath = path.join(DOCS_DIR_PREV, entry.filename);
    if (!fs.existsSync(fpath)) return res.status(404).json({error:'Archivo no encontrado'});
    buffer = fs.readFileSync(fpath);
  }
  const isPdf = entry.filename.endsWith('.pdf');
  res.setHeader('Content-Type', isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition',`attachment; filename="${entry.filename}"`);
  res.send(buffer);
});

app.delete('/registro-prev/:id', authMiddleware, requireModulo('preventivo'), async (req, res) => {
  const entry = await dbPrevFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  await storageMove(`prev/${entry.filename}`, `prev/papelera/${entry.filename}`);
  try {
    const fp = path.join(DOCS_DIR_PREV, entry.filename);
    if (fs.existsSync(fp)) fs.renameSync(fp, path.join(PAPELERA_DIR_PREV, entry.filename));
  } catch(e) {}
  await dbPrevDelete(entry.id);
  await dbPapaleraPrevInsert({ ...entry, deletedAt: new Date().toISOString() });
  res.json({ok:true});
});

app.get('/papelera-wom', authMiddleware, requireModulo('wom'), async (req, res) => res.json(filtrarInformesPorEmpresa(await dbPapeleraWomList(), req.user)));

app.post('/papelera-wom/restaurar/:id', authMiddleware, requireModulo('wom'), async (req, res) => {
  const entry = await dbPapeleraWomFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  await storageMove(`wom/papelera/${entry.filename}`, `wom/${entry.filename}`);
  try {
    const fp = path.join(PAPELERA_DIR_WOM, entry.filename);
    if (fs.existsSync(fp)) fs.renameSync(fp, path.join(DOCS_DIR_WOM, entry.filename));
  } catch(e) {}
  const { deletedAt, ...clean } = entry;
  await dbPapeleraWomDelete(entry.id);
  await dbWomInsert(clean);
  res.json({ok:true});
});

app.delete('/papelera-wom/:id', authMiddleware, requireModulo('wom'), async (req, res) => {
  const entry = await dbPapeleraWomFind(req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  if (!puedeVerInforme(entry, req.user)) return res.status(403).json({error:'Sin acceso a este informe'});
  await storageRemove([`wom/papelera/${entry.filename}`]);
  try {
    const fp = path.join(PAPELERA_DIR_WOM, entry.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch(e) {}
  await dbPapeleraWomDelete(entry.id);
  res.json({ok:true});
});

app.delete('/papelera-wom', authMiddleware, requireModulo('wom'), async (req, res) => {
  const papelera = filtrarInformesPorEmpresa(await dbPapeleraWomList(), req.user);
  if (papelera.length) {
    await storageRemove(papelera.map(e => `wom/papelera/${e.filename}`));
    papelera.forEach(e => {
      try {
        const fp = path.join(PAPELERA_DIR_WOM, e.filename); if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch(e2) {}
    });
  }
  if (req.user.rol === 'superadmin') await dbPapeleraWomClear();
  else for (const e of papelera) await dbPapeleraWomDelete(e.id);
  res.json({ok:true});
});

const os = require('os');
function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}
app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`✅ Servidor corriendo:`);
  console.log(`   PC:     http://localhost:${PORT}`);
  console.log(`   Celular (misma red WiFi): http://${ip}:${PORT}`);
  console.log(`   Informes guardados en: ./informes/`);
});
