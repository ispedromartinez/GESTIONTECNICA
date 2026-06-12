const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middleware/auth');
const { requireRol } = require('../middleware/roles');
const { dbClimaList } = require('../db/clima');
const { dbWomList } = require('../db/wom-db');

const router = express.Router();

const PROYECTOS_FILE = path.join(__dirname, '..', 'proyectos.json');
const PAPELERA_FILE  = path.join(__dirname, '..', 'papelera.json');
const LOGOS_DIR      = path.join(__dirname, '..', 'logos');
const CONTACTO_FILE  = path.join(__dirname, '..', 'contactos.json');

if (!fs.existsSync(PROYECTOS_FILE)) fs.writeFileSync(PROYECTOS_FILE, '[]');
if (!fs.existsSync(PAPELERA_FILE))  fs.writeFileSync(PAPELERA_FILE,  '[]');
if (!fs.existsSync(LOGOS_DIR))      fs.mkdirSync(LOGOS_DIR);

function loadProyectos()  { try { return JSON.parse(fs.readFileSync(PROYECTOS_FILE, 'utf8')); } catch (e) { return []; } }
function saveProyectos(d) { fs.writeFileSync(PROYECTOS_FILE, JSON.stringify(d, null, 2)); }
function loadPapelera()   { try { return JSON.parse(fs.readFileSync(PAPELERA_FILE,  'utf8')); } catch (e) { return []; } }
function savePapelera(d)  { fs.writeFileSync(PAPELERA_FILE,  JSON.stringify(d, null, 2)); }
function loadContactos()  { try { return JSON.parse(fs.readFileSync(CONTACTO_FILE, 'utf8'));  } catch (e) { return []; } }
function uuidSimple() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

router.use('/logos', express.static(LOGOS_DIR));

router.post('/api/contacto', (req, res) => {
  try {
    const { nombre, empresa, email, tel, mensaje, fecha } = req.body || {};
    if (!nombre || !email) return res.status(400).json({ error: 'nombre y email requeridos' });
    const lista = loadContactos();
    lista.push({ nombre, empresa, email, tel, mensaje, fecha: fecha || new Date().toISOString() });
    fs.writeFileSync(CONTACTO_FILE, JSON.stringify(lista, null, 2));
    console.log(`📬 Nuevo contacto: ${nombre} <${email}>`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Proyectos ──────────────────────────────────────────────────────────────────

router.get('/api/proyectos', authMiddleware, (req, res) => {
  try {
    res.json(loadProyectos().map(p => ({
      id: p.id, slug: p.slug, nombre: p.nombre, logo: p.logo, template: p.template,
      color: p.color, totalSitios: p.sitios?.length || 0,
      totalTecnicos: p.tecnicos?.length || 0, totalSupervisores: p.supervisores?.length || 0,
      creado_en: p.creado_en
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/proyectos/:slug', authMiddleware, (req, res) => {
  try {
    const p = loadProyectos().find(x => x.slug === req.params.slug);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json(p);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/proyectos', authMiddleware, requireRol('superadmin'), (req, res) => {
  try {
    const { nombre, slug, template, color, sitios, tecnicos, supervisores, logo } = req.body;
    if (!nombre || !slug || !template) return res.status(400).json({ error: 'nombre, slug y template requeridos' });
    const proyectos = loadProyectos();
    if (proyectos.find(p => p.slug === slug)) return res.status(409).json({ error: 'Ya existe un proyecto con ese identificador' });
    let logoPath = null;
    if (logo && logo.startsWith('data:image/')) {
      const ext = (logo.match(/data:image\/(\w+);/) || [])[1] || 'png';
      const fname = `${slug}.${ext}`;
      fs.writeFileSync(path.join(LOGOS_DIR, fname), Buffer.from(logo.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
      logoPath = `/logos/${fname}`;
    }
    const proyecto = {
      id: uuidSimple(), slug: slug.toLowerCase().replace(/\s+/g, '-'),
      nombre, logo: logoPath, template,
      color: color || (template === 'tigo' ? '#0073EA' : '#6161FF'),
      sitios: sitios || [], tecnicos: tecnicos || [], supervisores: supervisores || [],
      creado_en: new Date().toISOString()
    };
    proyectos.push(proyecto);
    saveProyectos(proyectos);
    const regFile = path.join(__dirname, '..', `registro_${proyecto.slug}.json`);
    if (!fs.existsSync(regFile)) fs.writeFileSync(regFile, '[]');
    res.json({ ok: true, proyecto });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/api/proyectos/:slug', authMiddleware, requireRol('superadmin'), (req, res) => {
  try {
    const ps = loadProyectos();
    const idx = ps.findIndex(p => p.slug === req.params.slug);
    if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
    const { nombre, empresa, color, sitios, tecnicos, supervisores } = req.body;
    if (nombre      !== undefined) ps[idx].nombre      = nombre.trim();
    if (empresa     !== undefined) ps[idx].empresa     = empresa;
    if (color       !== undefined) ps[idx].color       = color;
    if (sitios      !== undefined) ps[idx].sitios      = sitios;
    if (tecnicos    !== undefined) ps[idx].tecnicos    = tecnicos;
    if (supervisores !== undefined) ps[idx].supervisores = supervisores;
    saveProyectos(ps);
    res.json({ ok: true, proyecto: ps[idx] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/proyectos/:slug', authMiddleware, requireRol('superadmin'), (req, res) => {
  try {
    const ps = loadProyectos();
    const idx = ps.findIndex(p => p.slug === req.params.slug);
    if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
    const [eliminado] = ps.splice(idx, 1);
    saveProyectos(ps);
    const papelera = loadPapelera();
    papelera.unshift({ ...eliminado, eliminado_en: new Date().toISOString() });
    savePapelera(papelera);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Papelera ──────────────────────────────────────────────────────────────────

router.get('/api/papelera', authMiddleware, requireRol('superadmin'), (req, res) => {
  try { res.json(loadPapelera()); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/papelera/:slug/restaurar', authMiddleware, requireRol('superadmin'), (req, res) => {
  try {
    const papelera = loadPapelera();
    const idx = papelera.findIndex(p => p.slug === req.params.slug);
    if (idx === -1) return res.status(404).json({ error: 'No encontrado en papelera' });
    const [proyecto] = papelera.splice(idx, 1);
    delete proyecto.eliminado_en;
    savePapelera(papelera);
    const ps = loadProyectos();
    if (ps.find(p => p.slug === proyecto.slug)) return res.status(409).json({ error: 'Ya existe un proyecto activo con ese slug' });
    ps.push(proyecto);
    saveProyectos(ps);
    res.json({ ok: true, proyecto });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/papelera/:slug', authMiddleware, requireRol('superadmin'), (req, res) => {
  try {
    const papelera = loadPapelera();
    const idx = papelera.findIndex(p => p.slug === req.params.slug);
    if (idx === -1) return res.status(404).json({ error: 'No encontrado en papelera' });
    papelera.splice(idx, 1);
    savePapelera(papelera);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Dashboard ──────────────────────────────────────────────────────────────────

router.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const { nombre, rol } = req.user;
    const [tigo, wom] = await Promise.all([dbClimaList(null), dbWomList(null)]);

    const tigoNorm = tigo.map(r => ({
      id: r.id, proyecto: 'TIGO',
      sitio: r.nombreSitio || '—',
      tecnico: r.tecnico || '—',
      supervisor: r.supervisor || null,
      fecha: r.fecha || (r.fechaCreacion || '').slice(0, 10),
      codInforme: r.codInforme || '—'
    }));
    const womNorm = wom.map(r => {
      const tecs = Array.isArray(r.tecnicos) ? r.tecnicos : (r.tecnicos || '').split(',').map(s => s.trim());
      return {
        id: r.id, proyecto: 'WOM',
        sitio: r.instalacion || '—',
        tecnico: tecs.filter(Boolean).join(', ') || '—',
        supervisor: null,
        fecha: (r.fechaInicio || r.fechaCreacion || '').slice(0, 10),
        codInforme: r.ticket || r.codInterno || '—'
      };
    });

    let todos = [...tigoNorm, ...womNorm].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    const nombreLow = (nombre || '').toLowerCase();
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
      const d = new Date(r.fecha);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
    const tecnicosUnicos = [...new Set(todos.map(r => r.tecnico).filter(t => t && t !== '—'))].length;

    res.json({ informes: todos, stats: { totalMes, total: todos.length, tecnicos: tecnicosUnicos } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
