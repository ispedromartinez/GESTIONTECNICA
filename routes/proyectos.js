const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middleware/auth');
const { requireRol } = require('../middleware/roles');

const router = express.Router();

const PROYECTOS_FILE = path.join(__dirname, '..', 'proyectos.json');
const LOGOS_DIR      = path.join(__dirname, '..', 'logos');
const CONTACTO_FILE  = path.join(__dirname, '..', 'contactos.json');

if (!fs.existsSync(PROYECTOS_FILE)) fs.writeFileSync(PROYECTOS_FILE, '[]');
if (!fs.existsSync(LOGOS_DIR))      fs.mkdirSync(LOGOS_DIR);

function loadProyectos()  { try { return JSON.parse(fs.readFileSync(PROYECTOS_FILE, 'utf8')); } catch (e) { return []; } }
function saveProyectos(d) { fs.writeFileSync(PROYECTOS_FILE, JSON.stringify(d, null, 2)); }
function loadContactos()  { try { return JSON.parse(fs.readFileSync(CONTACTO_FILE, 'utf8'));  } catch (e) { return []; } }
function uuidSimple() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

router.use('/logos', express.static(LOGOS_DIR));

router.post('/api/contacto', (req, res) => {
  const { nombre, empresa, email, tel, mensaje, fecha } = req.body || {};
  if (!nombre || !email) return res.status(400).json({ error: 'nombre y email requeridos' });
  const lista = loadContactos();
  lista.push({ nombre, empresa, email, tel, mensaje, fecha: fecha || new Date().toISOString() });
  fs.writeFileSync(CONTACTO_FILE, JSON.stringify(lista, null, 2));
  console.log(`📬 Nuevo contacto: ${nombre} <${email}>`);
  res.json({ ok: true });
});

router.get('/api/proyectos', authMiddleware, (req, res) => {
  res.json(loadProyectos().map(p => ({
    id: p.id, slug: p.slug, nombre: p.nombre, logo: p.logo, template: p.template,
    color: p.color, totalSitios: p.sitios?.length || 0,
    totalTecnicos: p.tecnicos?.length || 0, totalSupervisores: p.supervisores?.length || 0,
    creado_en: p.creado_en
  })));
});

router.get('/api/proyectos/:slug', authMiddleware, (req, res) => {
  const p = loadProyectos().find(x => x.slug === req.params.slug);
  if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json(p);
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

router.delete('/api/proyectos/:slug', authMiddleware, requireRol('superadmin'), (req, res) => {
  const ps = loadProyectos();
  const idx = ps.findIndex(p => p.slug === req.params.slug);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  ps.splice(idx, 1);
  saveProyectos(ps);
  res.json({ ok: true });
});


module.exports = router;
