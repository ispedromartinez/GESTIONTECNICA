require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
// La generación Word vive en docx/clima.js y docx/wom.js (usan la lib docx);
// el PDF de Preventivo vive en routes/preventivoInformes.js (usa Puppeteer).
const authRoutes = require('./routes/auth');
const gestionRoutes = require('./routes/gestion');
const empresasRoutes = require('./routes/empresas');
const preventivoRoutes = require('./routes/preventivo');
const tigoRoutes = require('./routes/tigo');
const womRoutes = require('./routes/wom');
const preventivoInformesRoutes = require('./routes/preventivoInformes');
const gestionDb = require('./db/gestion');
const equiposDb = require('./db/equipos');
const sitiosDb = require('./db/sitios');
const { dbClimaList } = tigoRoutes;
const { dbWomList } = womRoutes;
const { dbPrevList, peekTrackerId } = preventivoInformesRoutes;
const { authMiddleware } = require('./middleware/auth');
const { requireRol, requireNivel } = require('./middleware/roles');
const { requireModulo } = require('./middleware/modulos');
const { canAccessTenant, scopeToTenant } = require('./middleware/tenant');
const { rateLimit } = require('./middleware/rateLimit');

// Cliente Supabase compartido (respeta USE_LOCAL_DB, igual que el resto de la app)
const { supabase } = require('./db/supabase');
const {
  sanitizeSearch, escapeLike, filtrarInformesPorEmpresa, puedeVerInforme,
  vincularInformeGestion, storageUpload, storageDownload, storageMove, storageRemove
} = require('./utils/informesCompartido');

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

// ── Informes TIGO/Clima (generación, registro, papelera) — sin prefijo,
// cada ruta interna aplica su propio authMiddleware + requireModulo('tigo')
app.use(tigoRoutes);

// ── Informes WOM (generación, registro, papelera) — sin prefijo,
// cada ruta interna aplica su propio authMiddleware + requireModulo('wom')
app.use(womRoutes);

// ── Informes Preventivo (generación PDF, registro, verificación pública) —
// sin prefijo, cada ruta interna aplica su propio authMiddleware +
// requireModulo('preventivo') (excepto /verificar-informe, intencionalmente pública)
app.use(preventivoInformesRoutes);

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
      // El área del proyecto (columna "categoria") debe ser un área activa de la
      // empresa (por nombre) o uno de los slugs legacy clima/energia/obras_civiles.
      const CATS_LEGACY = ['clima', 'energia', 'obras_civiles'];
      let categoriaFinal = null;
      if (categoria) {
        const areasEmp = await gestionDb.areasByEmpresa(empresa_id).catch(() => []);
        if (CATS_LEGACY.includes(categoria) || areasEmp.some(a => a.nombre === categoria))
          categoriaFinal = categoria;
      }
      await gestionDb.proyectoInsert({
        empresa_id, nombre, slug: proyecto.slug, estado: 'activo', fecha_inicio: null,
        logo: logoPath, template, color: proyecto.color,
        tipo: TIPOS.includes(tipo) ? tipo : 'correctivo',
        categoria: categoriaFinal
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
app.post('/api/proyectos/sitios/asignar', authMiddleware, requireNivel(2), (req, res) => {
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

// ── Búsqueda global ─────────────────────────────────────────────
// NOTA: server.js YA tiene `equiposDb` (L18), `sitiosDb` (L19) y `gestionDb` (L17).
// NO agregar requires. Usar esos nombres.

// Carga sitios ya scopeados por empresa (o todos para superadmin).
async function cargarSitios(req) {
  if (req.user.rol === 'superadmin') return await sitiosDb.listAll();
  const emp = req.user.empresa_id;
  if (!emp) return [];
  const mods = ['tigo', 'wom', 'preventivo'];
  const listas = await Promise.all(mods.map(m => sitiosDb.list(emp, m).catch(() => [])));
  return listas.flat();
}

app.get('/api/buscar', authMiddleware, async (req, res) => {
  const vacio = { informes: [], sitios: [], equipos: [], tecnicos: [] };
  const q = normBusq(req.query.q);
  if (q.length < 2) return res.json(vacio);
  const out = { informes: [], sitios: [], equipos: [], tecnicos: [] };

  // Informes (clima + wom)
  try {
    const [clima, wom] = await Promise.all([dbClimaList(null), dbWomList(null)]);
    const climaR = clima
      .filter(i => matchTexto(q, i.codInforme, i.nombreSitio, i.codigoSitio, i.tecnico, i.numOT, i.eqNumero))
      .map(i => ({ tipo: 'informe', subtipo: 'Tigo', id: i.id, codInforme: i.codInforme,
        nombreSitio: i.nombreSitio, tecnico: i.tecnico, fecha: i.fecha, filename: i.filename, empresaId: i.empresaId }));
    // OJO: el objeto WOM (fromWom) NO tiene codInforme/nombreSitio/numOT. Sus campos
    // reales son: ticket, codInterno, instalacion, tipoActividad, tecnicos, equipo, fechaInicio.
    const womR = wom
      .filter(i => matchTexto(q, i.ticket, i.codInterno, i.instalacion, i.tipoActividad, i.tecnicos, i.equipo))
      .map(i => ({ tipo: 'informe', subtipo: 'WOM', id: i.id, codInforme: i.ticket || i.codInterno || '',
        nombreSitio: i.instalacion, tecnico: i.tecnicos, fecha: i.fechaInicio, filename: i.filename, empresaId: i.empresaId }));
    out.informes = (await scopeBusqueda(req, 'informe', [...climaR, ...womR])).slice(0, 8);
  } catch (e) { console.error('buscar informes:', e.message); }

  // Sitios
  try {
    const sitios = (await cargarSitios(req))
      .filter(s => matchTexto(q, s.nombre, s.codigo, s.direccion))
      .map(s => ({ tipo: 'sitio', nombre: s.nombre, codigo: s.codigo, direccion: s.direccion, modulo: s.modulo || null }));
    out.sitios = (await scopeBusqueda(req, 'sitio', sitios)).slice(0, 8);
  } catch (e) { console.error('buscar sitios:', e.message); }

  // Equipos
  try {
    const eq = (await equiposDb.list())
      .filter(x => matchTexto(q, x.numero, x.sitio, x.marca, x.modelo))
      .map(x => ({ tipo: 'equipo', id: x.id, numero: x.numero, sitio: x.sitio,
        marca: x.marca, modelo: x.modelo, totalIntervenciones: x.totalIntervenciones, empresaId: x.empresaId }));
    out.equipos = (await scopeBusqueda(req, 'equipo', eq)).slice(0, 8);
  } catch (e) { console.error('buscar equipos:', e.message); }

  // Técnicos (usuarios)
  try {
    const empParam = req.user.rol === 'superadmin' ? null : req.user.empresa_id;
    const users = (await gestionDb.usuariosList(empParam))
      .filter(us => matchTexto(q, us.nombre, us.email))
      .map(us => ({ tipo: 'tecnico', id: us.id, nombre: us.nombre, email: us.email, rol: us.rol, empresa_id: us.empresa_id }));
    out.tecnicos = (await scopeBusqueda(req, 'tecnico', users)).slice(0, 8);
  } catch (e) { console.error('buscar tecnicos:', e.message); }

  res.json(out);
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

// ── GET /api/reportes – vista consolidada de reportes (Tigo/WOM/Prev) ──
// Visibilidad para supervisor/admin: quién reportó qué, cuándo, en qué sitio.
// Sin aprobación. Aislado por empresa; supervisor ve solo a sus técnicos a
// cargo; técnico solo los suyos. Filtros: modulo, tecnico, desde, hasta.
app.get('/api/reportes', authMiddleware, async (req, res) => {
  try {
    const { rol, nombre } = req.user;
    const [tigoAll, womAll, prevAll] = await Promise.all([
      dbClimaList(null), dbWomList(null), dbPrevList(null)
    ]);
    const tigo = filtrarInformesPorEmpresa(tigoAll, req.user).map(r => ({
      id: r.id, modulo: 'tigo', sitio: r.nombreSitio || '—',
      tecnico: r.tecnico || '—', fecha: r.fecha || (r.fechaCreacion || '').slice(0, 10),
      codigo: r.codInforme || '—', filename: r.filename || '',
      descargaUrl: `/descargar/${r.id}`
    }));
    const wom = filtrarInformesPorEmpresa(womAll, req.user).map(r => {
      const tecs = Array.isArray(r.tecnicos) ? r.tecnicos : (r.tecnicos || '').split(',').map(s => s.trim());
      return {
        id: r.id, modulo: 'wom', sitio: r.instalacion || '—',
        tecnico: tecs.filter(Boolean).join(', ') || '—',
        fecha: (r.fechaInicio || r.fechaCreacion || '').slice(0, 10),
        codigo: r.ticket || r.codInterno || '—', filename: r.filename || '',
        descargaUrl: `/descargar-wom/${r.id}`
      };
    });
    const prev = filtrarInformesPorEmpresa(prevAll, req.user).map(r => ({
      id: r.id, modulo: 'preventivo', sitio: r.nombreNodo || '—',
      tecnico: r.ejecutante || '—', fecha: r.fecha || (r.fechaCreacion || '').slice(0, 10),
      codigo: r.trackerId || '—', filename: r.filename || '',
      descargaUrl: `/descargar-prev/${r.id}`
    }));

    let reportes = [...tigo, ...wom, ...prev];

    // Recorte por rol: supervisor → sus técnicos a cargo + a quien asignó tarea;
    // técnico → él mismo.
    if (rol === 'supervisor') {
      let nombres = [];
      try {
        const [vinculados, asignados] = await Promise.all([
          gestionDb.tecnicosDeSupervisor(req.user.usuario_id),
          gestionDb.tecnicosAsignadosPorSupervisor(req.user.usuario_id)
        ]);
        nombres = [...(vinculados || []), ...(asignados || [])]
          .map(t => (t.nombre || '').toLowerCase()).filter(Boolean);
      } catch {}
      nombres.push((nombre || '').toLowerCase()); // incluye lo del propio supervisor
      reportes = reportes.filter(r =>
        nombres.some(n => n && r.tecnico.toLowerCase().includes(n)));
    } else if (rol === 'tecnico') {
      const n = (nombre || '').toLowerCase();
      reportes = reportes.filter(r => r.tecnico.toLowerCase().includes(n));
    }

    // Filtros opcionales.
    const { modulo, tecnico, desde, hasta } = req.query;
    if (modulo) reportes = reportes.filter(r => r.modulo === modulo);
    if (tecnico) reportes = reportes.filter(r => r.tecnico.toLowerCase().includes(tecnico.toLowerCase()));
    if (desde) reportes = reportes.filter(r => (r.fecha || '') >= desde);
    if (hasta) reportes = reportes.filter(r => (r.fecha || '') <= hasta);

    reportes.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    const now = new Date();
    const mes = reportes.filter(r => {
      const d = new Date(r.fecha); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
    const porModulo = reportes.reduce((a, r) => { a[r.modulo] = (a[r.modulo] || 0) + 1; return a; }, {});

    res.json({ reportes, stats: { total: reportes.length, mes, porModulo } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Búsqueda global: helpers ───────────────────────────────────
function normBusq(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
// true si qNorm (ya normalizado) está en alguno de los campos.
function matchTexto(qNorm, ...campos) {
  return campos.some(c => normBusq(c).includes(qNorm));
}

// Filtra filas de una fuente según el rol/empresa del usuario.
// tipo: 'informe' | 'sitio' | 'equipo' | 'tecnico'
async function scopeBusqueda(req, tipo, filas) {
  const u = req.user;
  if (u.rol === 'superadmin') return filas;
  const emp = u.empresa_id || null;

  // Base: recorta por empresa primero.
  let base;
  if (tipo === 'informe' || tipo === 'equipo') base = filas.filter(f => (f.empresaId || null) === emp);
  else if (tipo === 'tecnico') base = filas.filter(f => (f.empresa_id || null) === emp);
  else base = filas; // sitios ya vienen scopeados por empresa

  // admin_empresa: empresa alcanza.
  if (u.rol === 'admin_empresa') return base;

  // supervisor / tecnico: además, por nombre de técnico.
  const yo = await gestionDb.usuarioById(u.usuario_id).catch(() => null);
  const nombres = new Set();
  const n = normBusq(yo && yo.nombre); if (n) nombres.add(n);
  if (u.rol === 'supervisor') {
    const tecs = await gestionDb.tecnicosDeSupervisor(u.usuario_id).catch(() => []);
    for (const t of tecs) { const n = normBusq(t && t.nombre); if (n) nombres.add(n); }
  }

  if (tipo === 'informe') {
    // clima: 'tecnico' (uno); wom: 'tecnico' aquí ya trae la cadena de 'tecnicos' (coma-separada)
    return base.filter(f => {
      const partes = String(f.tecnico || '').split(',').map(normBusq).filter(Boolean);
      return partes.some(p => nombres.has(p));
    });
  }
  if (tipo === 'tecnico') {
    // supervisor: él + sus técnicos; tecnico: solo él
    return base.filter(f => nombres.has(normBusq(f.nombre)));
  }
  // sitios / equipos: a nivel empresa (no se recortan por técnico).
  return base;
}

// ── Routes ────────────────────────────────────────────────
app.get('/ping', (req,res) => res.json({ok:true}));

app.get('/version', (req,res) => {
  try {
    const mtime = fs.statSync(path.join(__dirname, 'informe_clima_app.html')).mtimeMs;
    res.json({ v: mtime });
  } catch { res.json({ v: 0 }); }
});

// ── Sitios Preventivos (Excel lookup) ─────────────────────────
// Acepta el nombre histórico o la planilla real "SITIOS.xlsx" del usuario.
const SITIOS_XLSX   = [
  path.join(__dirname, 'sitios_preventivos.xlsx'),
  path.join(__dirname, 'SITIOS.xlsx')
].find(p => fs.existsSync(p)) || path.join(__dirname, 'SITIOS.xlsx');

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

// Parsea un .xlsx (Buffer) a la lista de sitios, tolerando distintos formatos
// de encabezado. Usado por /upload e /importar.
function parseSitiosXlsx(buf) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheetName = wb.SheetNames.find(n => /sitio/i.test(n)) || wb.SheetNames[0];
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
  const pick = (f, ...keys) => {
    for (const k of Object.keys(f)) {
      const lk = k.trim().toLowerCase();
      if (keys.some(x => lk.includes(x))) { const v = String(f[k] ?? '').trim(); if (v) return v; }
    }
    return '';
  };
  return filas.map(f => ({
    nombre: pick(f, 'sitio', 'central', 'nodo', 'hub', 'nombre'),
    direccion: pick(f, 'direcc'),
    ciudad: pick(f, 'comuna', 'ciudad'),
    criticidad: pick(f, 'criticidad'),
    categoria: pick(f, 'categor'),
    codigo: pick(f, 'código', 'codigo', 'punto de inter')
  })).filter(s => s.nombre);
}

// Clave de duplicado: mismo nombre + dirección + comuna (normalizados).
const sitioKey = s => ['nombre', 'direccion', 'ciudad']
  .map(k => (s[k] || '').toString().trim().toLowerCase().replace(/\s+/g, ' '))
  .join('|');

// Fallback local (dev, sin Supabase): la capa db/sitios.js reutiliza el xlsx.
sitiosDb.setLocalImpl({ load: loadSitiosPrev, save: saveSitiosPrev });

// Empresa objetivo del catálogo: la del usuario, o ?empresaId para superadmin
// (que no tiene empresa propia). Devuelve null si no se puede determinar.
function empresaCatalogo(req) {
  return req.user.empresa_id || req.query.empresaId || req.body?.empresaId || null;
}
// Módulo del catálogo (tigo/wom/preventivo). Default preventivo por
// compatibilidad con el endpoint histórico /api/sitios-preventivos.
function moduloCatalogo(req) {
  return sitiosDb.normModulo(req.query.modulo || req.body?.modulo || 'preventivo');
}

// ── Sitios / Tracker API ────────────────────────────────────────
app.get('/api/sitios-preventivos', authMiddleware, async (req, res) => {
  try {
    const empresaId = empresaCatalogo(req);
    if (!empresaId) return res.json([]); // superadmin sin ?empresaId → vacío
    res.json(await sitiosDb.list(empresaId, moduloCatalogo(req)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// reload ya no aplica (no hay cache global); se conserva por compatibilidad.
app.post('/api/sitios-preventivos/reload', authMiddleware, requireNivel(3), async (req, res) => {
  try {
    const empresaId = empresaCatalogo(req);
    if (!empresaId) return res.status(400).json({ error: 'empresaId requerido' });
    res.json({ ok: true, count: await sitiosDb.count(empresaId, moduloCatalogo(req)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Reemplaza TODO el catálogo del módulo con el xlsx subido.
app.post('/api/sitios-preventivos/upload', authMiddleware, requireNivel(3), async (req, res) => {
  try {
    const empresaId = empresaCatalogo(req);
    if (!empresaId) return res.status(400).json({ error: 'empresaId requerido' });
    const { dataBase64 } = req.body;
    if (!dataBase64) return res.status(400).json({ error: 'dataBase64 requerido' });
    const sitios = parseSitiosXlsx(Buffer.from(dataBase64, 'base64'));
    const { count } = await sitiosDb.replaceAll(empresaId, moduloCatalogo(req), sitios);
    res.json({ ok: true, count });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// Alta individual de un sitio. 409 si ya existe uno con la misma información.
// Nivel 3 (admin) O el propio flujo de generación (ver /api/sitios-auto).
app.post('/api/sitios-preventivos', authMiddleware, requireNivel(3), async (req, res) => {
  try {
    const empresaId = empresaCatalogo(req);
    if (!empresaId) return res.status(400).json({ error: 'empresaId requerido' });
    const b = req.body || {};
    const nombre = (b.nombre || '').toString().trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre del sitio es obligatorio' });
    const r = await sitiosDb.add(empresaId, moduloCatalogo(req), b);
    if (r.duplicado) return res.status(409).json({ error: 'Ya existe un sitio con la misma información', existente: r.existente });
    res.json({ ok: true, sitio: r.sitio, count: r.count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Alta silenciosa al generar un informe: cualquier usuario con acceso al
// módulo puede registrar el sitio que acaba de usar (upsert idempotente).
// No es admin: es parte del flujo normal de generación. Si ya existe, no hace nada.
app.post('/api/sitios-auto', authMiddleware, async (req, res) => {
  try {
    const empresaId = empresaCatalogo(req);
    const b = req.body || {};
    const nombre = (b.nombre || '').toString().trim();
    if (!empresaId || !nombre) return res.json({ ok: true, skipped: true });
    const r = await sitiosDb.add(empresaId, moduloCatalogo(req), b);
    res.json({ ok: true, duplicado: !!r.duplicado });
  } catch (e) { res.json({ ok: false, error: e.message }); } // nunca rompe la generación
});

// Carga masiva: AÑADE (no reemplaza). Inserta los no repetidos y devuelve
// los duplicados (nuevo vs existente) para que el usuario elija cuál dejar.
app.post('/api/sitios-preventivos/importar', authMiddleware, requireNivel(3), async (req, res) => {
  try {
    const empresaId = empresaCatalogo(req);
    if (!empresaId) return res.status(400).json({ error: 'empresaId requerido' });
    const { dataBase64 } = req.body || {};
    if (!dataBase64) return res.status(400).json({ error: 'dataBase64 requerido' });
    const nuevos = parseSitiosXlsx(Buffer.from(dataBase64, 'base64'));
    const r = await sitiosDb.bulkImport(empresaId, moduloCatalogo(req), nuevos);
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Resolver duplicados: reemplaza el sitio existente por la versión nueva elegida.
app.post('/api/sitios-preventivos/resolver', authMiddleware, requireNivel(3), async (req, res) => {
  try {
    const empresaId = empresaCatalogo(req);
    if (!empresaId) return res.status(400).json({ error: 'empresaId requerido' });
    const { decisiones } = req.body || {};
    if (!Array.isArray(decisiones)) return res.status(400).json({ error: 'decisiones requerido' });
    const r = await sitiosDb.resolve(empresaId, moduloCatalogo(req), decisiones);
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/preview-tracker', authMiddleware, (_req, res) => {
  res.json({ next: peekTrackerId() });
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
