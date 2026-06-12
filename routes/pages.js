const express = require('express');
const fs = require('fs');
const path = require('path');
const { supabase, SUPABASE_BUCKET } = require('../db/supabase');

const router = express.Router();
const ROOT = path.join(__dirname, '..');

router.get('/',               (_req, res) => res.sendFile(path.join(ROOT, 'landing.html')));
router.get('/login',          (_req, res) => res.sendFile(path.join(ROOT, 'login.html')));
router.get('/selector',       (_req, res) => res.sendFile(path.join(ROOT, 'selector.html')));
router.get('/tigo',           (_req, res) => res.sendFile(path.join(ROOT, 'informe_clima_app.html')));
router.get('/wom',            (_req, res) => res.sendFile(path.join(ROOT, 'informe_wom_app.html')));
router.get('/admin',          (_req, res) => res.sendFile(path.join(ROOT, 'admin.html')));
router.get('/dashboard',      (_req, res) => res.sendFile(path.join(ROOT, 'dashboard.html')));
router.get('/nuevo-proyecto', (_req, res) => res.sendFile(path.join(ROOT, 'nuevo_proyecto.html')));
router.get('/proyecto/:slug', (_req, res) => res.sendFile(path.join(ROOT, 'proyecto.html')));

router.get('/ping', (_req, res) => res.json({ ok: true }));

router.get('/ping-supabase', async (_req, res) => {
  if (!supabase) return res.json({ ok: false, error: 'SUPABASE_URL o SUPABASE_KEY no configuradas' });
  const { error } = await supabase.from('informes_clima').select('id').limit(1);
  if (error) return res.json({ ok: false, error: error.message });
  res.json({ ok: true, bucket: SUPABASE_BUCKET });
});

router.get('/version', (_req, res) => {
  try {
    const mtime = fs.statSync(path.join(ROOT, 'informe_clima_app.html')).mtimeMs;
    res.json({ v: mtime });
  } catch { res.json({ v: 0 }); }
});

module.exports = router;
