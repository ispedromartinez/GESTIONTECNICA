const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middleware/auth');
const { sanitizeSearch, storageUpload, storageDownload, storageMove, storageRemove } = require('../db/supabase');
const { dbWomList, dbWomInsert, dbWomFind, dbWomDelete,
        dbPapeleraWomList, dbPapeleraWomInsert, dbPapeleraWomFind, dbPapeleraWomDelete, dbPapeleraWomClear } = require('../db/wom-db');
const { buildDocxWom } = require('../lib/docx-wom');
const { RSO_SITES, ACTIVIDADES_WOM } = require('../data/wom');

const router = express.Router();

const DOCS_DIR_WOM     = path.join(__dirname, '..', 'informes_wom');
const PAPELERA_DIR_WOM = path.join(__dirname, '..', 'papelera_wom');

if (!fs.existsSync(DOCS_DIR_WOM))     fs.mkdirSync(DOCS_DIR_WOM);
if (!fs.existsSync(PAPELERA_DIR_WOM)) fs.mkdirSync(PAPELERA_DIR_WOM);

router.get('/sitios-rso',     (_req, res) => res.json(RSO_SITES));
router.get('/actividades-wom', (_req, res) => res.json(ACTIVIDADES_WOM));

router.post('/generar-wom', authMiddleware, async (req, res) => {
  try {
    const d = req.body;
    const buffer = await buildDocxWom(d);
    const ticket = (d.ticket || 'WOM').replace(/[^a-zA-Z0-9\-_]/g, '_').slice(0, 50);
    const fname  = `${ticket}_WOM.docx`;
    fs.writeFileSync(path.join(DOCS_DIR_WOM, fname), buffer);
    await storageUpload(buffer, `wom/${fname}`);

    const entry = {
      id: Date.now().toString(),
      fechaCreacion: new Date().toISOString(),
      ticket: d.ticket, codInterno: d.codInterno,
      fechaInicio: d.fechaInicio, instalacion: d.instalacion,
      tipoActividad: d.tipoActividad,
      tecnicos: (d.tecnicos || []).filter(Boolean).join(', '),
      photoCount: (d.photos || []).filter(Boolean).length,
      filename: fname
    };
    await dbWomInsert(entry);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.get('/registro-wom', authMiddleware, async (req, res) => {
  res.json(await dbWomList(sanitizeSearch(req.query.q)));
});

router.get('/descargar-wom/:id', authMiddleware, async (req, res) => {
  const entry = await dbWomFind(req.params.id);
  if (!entry) return res.status(404).json({ error: 'No encontrado' });
  let buffer = await storageDownload(`wom/${entry.filename}`);
  if (!buffer) {
    const fpath = path.join(DOCS_DIR_WOM, entry.filename);
    if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'Archivo no encontrado' });
    buffer = fs.readFileSync(fpath);
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${entry.filename}"`);
  res.send(buffer);
});

router.delete('/registro-wom/:id', authMiddleware, async (req, res) => {
  const entry = await dbWomFind(req.params.id);
  if (!entry) return res.status(404).json({ error: 'No encontrado' });
  await storageMove(`wom/${entry.filename}`, `wom/papelera/${entry.filename}`);
  try {
    const fp = path.join(DOCS_DIR_WOM, entry.filename);
    if (fs.existsSync(fp)) fs.renameSync(fp, path.join(PAPELERA_DIR_WOM, entry.filename));
  } catch (e) {}
  await dbWomDelete(entry.id);
  await dbPapeleraWomInsert({ ...entry, deletedAt: new Date().toISOString() });
  res.json({ ok: true });
});

router.get('/papelera-wom', authMiddleware, async (_req, res) => {
  res.json(await dbPapeleraWomList());
});

router.post('/papelera-wom/restaurar/:id', authMiddleware, async (req, res) => {
  const entry = await dbPapeleraWomFind(req.params.id);
  if (!entry) return res.status(404).json({ error: 'No encontrado' });
  await storageMove(`wom/papelera/${entry.filename}`, `wom/${entry.filename}`);
  try {
    const fp = path.join(PAPELERA_DIR_WOM, entry.filename);
    if (fs.existsSync(fp)) fs.renameSync(fp, path.join(DOCS_DIR_WOM, entry.filename));
  } catch (e) {}
  const { deletedAt, ...clean } = entry;
  await dbPapeleraWomDelete(entry.id);
  await dbWomInsert(clean);
  res.json({ ok: true });
});

router.delete('/papelera-wom/:id', authMiddleware, async (req, res) => {
  const entry = await dbPapeleraWomFind(req.params.id);
  if (!entry) return res.status(404).json({ error: 'No encontrado' });
  await storageRemove([`wom/papelera/${entry.filename}`]);
  try { const fp = path.join(PAPELERA_DIR_WOM, entry.filename); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
  await dbPapeleraWomDelete(entry.id);
  res.json({ ok: true });
});

router.delete('/papelera-wom', authMiddleware, async (_req, res) => {
  const papelera = await dbPapeleraWomList();
  if (papelera.length) {
    await storageRemove(papelera.map(e => `wom/papelera/${e.filename}`));
    papelera.forEach(e => {
      try { const fp = path.join(PAPELERA_DIR_WOM, e.filename); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e2) {}
    });
  }
  await dbPapeleraWomClear();
  res.json({ ok: true });
});

module.exports = router;
