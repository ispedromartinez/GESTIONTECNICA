require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { supabase, SUPABASE_BUCKET } = require('./db/supabase');
const authRoutes     = require('./routes/auth');
const tigoRoutes     = require('./routes/tigo');
const womRoutes      = require('./routes/wom');
const proyectosRoutes = require('./routes/proyectos');

const app = express();
app.use(cors());
app.use(express.json({ limit: '80mb' }));
app.use(express.static(__dirname));

// ── Rutas de autenticación
app.use('/auth', authRoutes);

// ── Rutas de negocio
app.use('/', tigoRoutes);
app.use('/', womRoutes);
app.use('/', proyectosRoutes);

// ── Páginas HTML
app.get('/',              (_req, res) => res.sendFile(path.join(__dirname, 'landing.html')));
app.get('/login',         (_req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/selector',      (_req, res) => res.sendFile(path.join(__dirname, 'selector.html')));
app.get('/tigo',          (_req, res) => res.sendFile(path.join(__dirname, 'informe_clima_app.html')));
app.get('/wom',           (_req, res) => res.sendFile(path.join(__dirname, 'informe_wom_app.html')));
app.get('/admin',         (_req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/dashboard',     (_req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/nuevo-proyecto',(_req, res) => res.sendFile(path.join(__dirname, 'nuevo_proyecto.html')));
app.get('/proyecto/:slug',(_req, res) => res.sendFile(path.join(__dirname, 'proyecto.html')));

// ── Utilitarios
app.get('/ping', (_req, res) => res.json({ ok: true }));

app.get('/ping-supabase', async (_req, res) => {
  if (!supabase) return res.json({ ok: false, error: 'SUPABASE_URL o SUPABASE_KEY no configuradas' });
  const { error } = await supabase.from('informes_clima').select('id').limit(1);
  if (error) return res.json({ ok: false, error: error.message });
  res.json({ ok: true, bucket: SUPABASE_BUCKET });
});

app.get('/test-insert', async (_req, res) => {
  if (!supabase) return res.json({ ok: false, error: 'Supabase no configurado' });
  const testId = 'test-' + Date.now();
  const { error: insertError } = await supabase.from('informes_clima').insert({
    id: testId, fecha: '2026-01-01', fecha_creacion: new Date().toISOString(),
    cod_informe: 'TEST-001', nombre_sitio: 'Sitio Test', codigo_sitio: 'TST',
    tecnico: 'Test', supervisor: 'Test', num_ot: '000', photo_count: 0, filename: 'test.docx'
  });
  if (insertError) return res.json({ ok: false, paso: 'insert', error: insertError.message });
  const { data, error: selectError } = await supabase.from('informes_clima').select('*').eq('id', testId).single();
  if (selectError) return res.json({ ok: false, paso: 'select', error: selectError.message });
  await supabase.from('informes_clima').delete().eq('id', testId);
  res.json({ ok: true, mensaje: 'Insert y select funcionan correctamente', registro: data });
});

app.get('/version', (_req, res) => {
  try {
    const mtime = fs.statSync(path.join(__dirname, 'informe_clima_app.html')).mtimeMs;
    res.json({ v: mtime });
  } catch { res.json({ v: 0 }); }
});

// ── Arranque
const os = require('os');
function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`✅ Servidor corriendo:`);
  console.log(`   PC:     http://localhost:${PORT}`);
  console.log(`   Celular (misma red WiFi): http://${ip}:${PORT}`);
  console.log(`   Informes guardados en: ./informes/`);
});
