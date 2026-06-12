require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const os       = require('os');

const authRoutes      = require('./routes/auth');
const tigoRoutes      = require('./routes/tigo');
const womRoutes       = require('./routes/wom');
const proyectosRoutes = require('./routes/proyectos');
const pagesRoutes     = require('./routes/pages');

const app = express();
app.use(cors());
app.use(express.json({ limit: '80mb' }));
app.use(express.static(__dirname));

app.use('/auth', authRoutes);
app.use('/', tigoRoutes);
app.use('/', womRoutes);
app.use('/', proyectosRoutes);
app.use('/', pagesRoutes);

// Manejo global de errores en rutas (evita que el proceso caiga por excepciones en handlers)
app.use((err, req, res, _next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err);
  if (!res.headersSent) res.status(500).json({ error: 'Error interno del servidor' });
});

function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// Captura excepciones no manejadas para que el proceso no muera silenciosamente
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`✅ Servidor corriendo:`);
  console.log(`   PC:     http://localhost:${PORT}`);
  console.log(`   Celular (misma red WiFi): http://${ip}:${PORT}`);
});
