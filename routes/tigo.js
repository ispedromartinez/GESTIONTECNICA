const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { authMiddleware } = require('../middleware/auth');
const { sanitizeSearch, storageUpload, storageDownload, storageMove, storageRemove } = require('../db/supabase');
const { dbClimaList, dbClimaInsert, dbClimaFind, dbClimaDelete,
        dbPapeleraList, dbPapeleraInsert, dbPapeleraFind, dbPapeleraDelete, dbPapeleraClear } = require('../db/clima');
const { buildDocx } = require('../lib/docx-clima');

const router = express.Router();

const DOCS_DIR     = path.join(__dirname, '..', 'informes');
const PAPELERA_DIR = path.join(__dirname, '..', 'papelera');

if (!fs.existsSync(DOCS_DIR))     fs.mkdirSync(DOCS_DIR);
if (!fs.existsSync(PAPELERA_DIR)) fs.mkdirSync(PAPELERA_DIR);

router.post('/generar', authMiddleware, async (req, res) => {
  try {
    const d = req.body;
    const buffer = await buildDocx(d);
    const sitePart = (d.nombreSitio || 'Clima').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 25);
    const fname = `${d.codInforme || 'Informe'}_${sitePart}.docx`;
    fs.writeFileSync(path.join(DOCS_DIR, fname), buffer);
    await storageUpload(buffer, `clima/${fname}`);

    const entry = {
      id: Date.now().toString(),
      fecha: d.fecha, fechaCreacion: new Date().toISOString(),
      codInforme: d.codInforme, nombreSitio: d.nombreSitio,
      codigoSitio: d.codigoSitio, tecnico: d.tecnico,
      supervisor: d.supervisor, numOT: d.numOT,
      photoCount: (d.photos || []).filter(Boolean).length,
      filename: fname
    };
    await dbClimaInsert(entry);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

router.get('/registro', authMiddleware, async (req, res) => {
  res.json(await dbClimaList(sanitizeSearch(req.query.q)));
});

router.get('/descargar/:id', authMiddleware, async (req, res) => {
  const entry = await dbClimaFind(req.params.id);
  if (!entry) return res.status(404).json({ error: 'No encontrado' });
  let buffer = await storageDownload(`clima/${entry.filename}`);
  if (!buffer) {
    const fpath = path.join(DOCS_DIR, entry.filename);
    if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'Archivo no existe' });
    buffer = fs.readFileSync(fpath);
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${entry.filename}"`);
  res.send(buffer);
});

router.post('/enviar/:id', authMiddleware, async (req, res) => {
  const entry = await dbClimaFind(req.params.id);
  if (!entry) return res.status(404).json({ error: 'No encontrado' });
  let buffer = await storageDownload(`clima/${entry.filename}`);
  if (!buffer) {
    const fpath = path.join(DOCS_DIR, entry.filename);
    if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'Archivo no existe' });
    buffer = fs.readFileSync(fpath);
  }
  const { to, smtpHost, smtpPort, smtpUser, smtpPass } = req.body;
  if (!to) return res.status(400).json({ error: 'Email requerido' });
  try {
    const t = nodemailer.createTransport({ host: smtpHost || 'smtp.gmail.com', port: smtpPort || 587, secure: false, auth: { user: smtpUser, pass: smtpPass } });
    await t.sendMail({
      from: smtpUser, to,
      subject: `Informe - ${entry.nombreSitio} - ${entry.codInforme}`,
      text: `Adjunto informe.\nSitio: ${entry.nombreSitio}\nFecha: ${entry.fecha}\nTécnico: ${entry.tecnico}`,
      attachments: [{ filename: entry.filename, content: buffer }]
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/registro/:id', authMiddleware, async (req, res) => {
  const entry = await dbClimaFind(req.params.id);
  if (!entry) return res.status(404).json({ error: 'No encontrado' });
  await storageMove(`clima/${entry.filename}`, `clima/papelera/${entry.filename}`);
  try {
    const src = path.join(DOCS_DIR, entry.filename);
    if (fs.existsSync(src)) fs.renameSync(src, path.join(PAPELERA_DIR, entry.filename));
  } catch (e) {}
  await dbClimaDelete(entry.id);
  await dbPapeleraInsert({ ...entry, fechaEliminado: new Date().toISOString() });
  res.json({ ok: true });
});

router.get('/papelera', authMiddleware, async (req, res) => {
  res.json(await dbPapeleraList(sanitizeSearch(req.query.q)));
});

router.post('/papelera/restaurar/:id', authMiddleware, async (req, res) => {
  const entry = await dbPapeleraFind(req.params.id);
  if (!entry) return res.status(404).json({ error: 'No encontrado' });
  await storageMove(`clima/papelera/${entry.filename}`, `clima/${entry.filename}`);
  try {
    const src = path.join(PAPELERA_DIR, entry.filename);
    if (fs.existsSync(src)) fs.renameSync(src, path.join(DOCS_DIR, entry.filename));
  } catch (e) {}
  const { fechaEliminado, ...clean } = entry;
  await dbPapeleraDelete(entry.id);
  await dbClimaInsert(clean);
  res.json({ ok: true });
});

router.delete('/papelera/:id', authMiddleware, async (req, res) => {
  const entry = await dbPapeleraFind(req.params.id);
  if (!entry) return res.status(404).json({ error: 'No encontrado' });
  await storageRemove([`clima/papelera/${entry.filename}`]);
  try { const f = path.join(PAPELERA_DIR, entry.filename); if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
  await dbPapeleraDelete(entry.id);
  res.json({ ok: true });
});

router.delete('/papelera', authMiddleware, async (req, res) => {
  const papelera = await dbPapeleraList(null);
  if (papelera.length) {
    await storageRemove(papelera.map(e => `clima/papelera/${e.filename}`));
    papelera.forEach(e => {
      try { const f = path.join(PAPELERA_DIR, e.filename); if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e2) {}
    });
  }
  await dbPapeleraClear();
  res.json({ ok: true });
});

module.exports = router;
