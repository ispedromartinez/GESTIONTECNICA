const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { dbClimaList } = require('../db/clima');
const { dbWomList } = require('../db/wom-db');

const router = express.Router();

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
