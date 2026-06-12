const PDFDocument = require('pdfkit');
const fs          = require('fs');
const path        = require('path');

const BLUE   = '#1F497D';
const BL_L   = '#D6E4F0';
const GRAY   = '#D9D9D9';
const BORDER = '#9E9E9E';
const WHT    = '#FFFFFF';

const ML = 36;
const MR = 36;
const PW = 595.28;
const W  = PW - ML - MR;

function rct(doc, x, y, w, h, fill, stroke) {
  doc.save();
  if (fill)   doc.fillColor(fill);
  if (stroke) doc.strokeColor(stroke);
  if (fill && stroke) doc.rect(x, y, w, h).fillAndStroke();
  else if (fill)      doc.rect(x, y, w, h).fill();
  else if (stroke)    doc.rect(x, y, w, h).stroke();
  doc.restore();
}

function cell(doc, x, y, w, h, text, { bg = WHT, color = '#1a1a1a', bold = false,
                                        sz = 8, center = false, top = false } = {}) {
  rct(doc, x, y, w, h, bg, BORDER);
  const pad = 4;
  const fw = w - pad * 2;
  const fn = bold ? 'Helvetica-Bold' : 'Helvetica';
  const str = String(text ?? '—');
  doc.save().font(fn).fontSize(sz).fillColor(color);
  const th = doc.heightOfString(str, { width: fw });
  const ty = top ? y + pad : y + Math.max(pad, (h - th) / 2);
  doc.text(str, x + pad, ty, { width: fw, align: center ? 'center' : 'left', lineBreak: true });
  doc.restore();
}

function bluCell(doc, x, y, w, h, text, sz = 8) {
  cell(doc, x, y, w, h, text, { bg: BLUE, color: WHT, bold: true, sz, center: false });
}

function secHdr(doc, y, text) {
  const h = 18;
  rct(doc, ML, y, W, h, BLUE, BORDER);
  doc.save().font('Helvetica-Bold').fontSize(9).fillColor(WHT)
     .text(text, ML + 6, y + 5, { width: W - 12 }).restore();
  return y + h;
}

async function buildPdf(d) {
  const v = s => String(s || '').trim() || '—';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 36, bottom: 36, left: ML, right: MR }, autoFirstPage: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = 36;
    const rh = 20;

    // ── HEADER ──
    const logoW = W * 0.52;
    const otW   = W - logoW;
    const otH   = rh * 6;
    const hdrH  = otH;

    // Logo area
    rct(doc, ML, y, logoW, hdrH, '#FAFAFA', BORDER);
    try {
      let logoPath = path.join(__dirname, '..', 'icetel-logo.jpeg');
      if (!fs.existsSync(logoPath)) logoPath = path.join(__dirname, '..', 'logo.png');
      if (fs.existsSync(logoPath))
        doc.image(logoPath, ML + 6, y + 6, { fit: [logoW - 12, hdrH * 0.55], align: 'center', valign: 'center' });
    } catch {}
    try {
      const wPath = path.join(__dirname, '..', 'wom-logo.png');
      if (fs.existsSync(wPath))
        doc.image(wPath, ML + 8, y + hdrH * 0.58, { fit: [logoW * 0.4, hdrH * 0.35], align: 'left', valign: 'center' });
    } catch {}

    // OT table
    const ox = ML + logoW;
    bluCell(doc, ox, y,       otW,     rh,    'ORDEN DE TRABAJO', 9);
    cell(doc, ox, y+rh,       otW/2,   rh,    'Código Interno',   { bg: BL_L, bold: true, sz: 7 });
    cell(doc, ox+otW/2, y+rh, otW/2,   rh,    v(d.codInterno),    { sz: 8 });
    cell(doc, ox, y+rh*2,     otW/2,   rh,    'Ticket',           { bg: BL_L, bold: true, sz: 7 });
    cell(doc, ox+otW/2, y+rh*2, otW/2, rh,    v(d.ticket),        { sz: 8, bold: true });
    bluCell(doc, ox, y+rh*3,  otW,     rh,    'Fecha OT');
    cell(doc, ox, y+rh*4,     otW/2,   rh,    'Inicio:',  { bg: BL_L, bold: true, sz: 7 });
    cell(doc, ox+otW/2, y+rh*4, otW/2, rh,    `${v(d.fechaInicio)}  ${v(d.horaInicio)}`, { sz: 7.5 });
    cell(doc, ox, y+rh*5,     otW/2,   rh,    'Término:', { bg: BL_L, bold: true, sz: 7 });
    cell(doc, ox+otW/2, y+rh*5, otW/2, rh,    `${v(d.fechaTermino)}  ${v(d.horaTermino)}`, { sz: 7.5 });
    y += hdrH + 6;

    // ── INFO GENERAL ──
    const lw = W * 0.22, vw = W - lw;
    const rows = [
      ['Cliente',          'WOM'],
      ['Sistemas',         v(d.infraestructura)],
      ['Tipo de actividad',v(d.tipoActividad)],
      ['Instalación',      v(d.instalacion)],
      ['Dirección',        v(d.direccion)],
    ];
    for (const [label, value] of rows) {
      bluCell(doc, ML,    y, lw, rh, label);
      cell(doc, ML + lw,  y, vw, rh, value, { sz: 7.5 });
      y += rh;
    }
    y += 4;

    // ── TRABAJOS REALIZADOS ──
    y = secHdr(doc, y, 'TRABAJOS REALIZADOS');
    const trabajos = v(d.trabajos) === '—' ? '' : v(d.trabajos);
    const twH = Math.max(50, doc.heightOfString(trabajos || ' ', { width: W - 12 }) + 12);
    rct(doc, ML, y, W, twH, '#FAFAFA', BORDER);
    doc.save().font('Helvetica').fontSize(8).fillColor('#333')
       .text(trabajos || ' ', ML + 6, y + 6, { width: W - 12, lineBreak: true }).restore();
    y += twH + 4;

    // ── OBSERVACIONES ──
    y = secHdr(doc, y, 'OBSERVACIONES');
    const obs = v(d.observaciones) === '—' ? 'Sin observaciones adicionales' : v(d.observaciones);
    const obsH = Math.max(40, doc.heightOfString(obs, { width: W - 12 }) + 12);
    rct(doc, ML, y, W, obsH, '#FAFAFA', BORDER);
    doc.save().font('Helvetica').fontSize(8).fillColor('#333')
       .text(obs, ML + 6, y + 6, { width: W - 12, lineBreak: true }).restore();
    y += obsH + 4;

    // ── TÉCNICOS + DATOS GENERALES ──
    const tecNames = (d.tecnicos || []).filter(Boolean).join('    /    ') || '—';
    const tecW = W * 0.52;
    const datW = W - tecW - 4;
    bluCell(doc, ML,        y, tecW, rh, 'Técnico(s) Responsable(s)');
    bluCell(doc, ML+tecW+4, y, datW, rh, 'Datos generales');
    y += rh;
    cell(doc, ML,         y, tecW, rh, `Nombre: ${tecNames}`, { sz: 7.5 });
    cell(doc, ML+tecW+4,  y, datW/2, rh, 'Sala',   { bg: BL_L, bold: true, sz: 7 });
    cell(doc, ML+tecW+4+datW/2, y, datW/2, rh, v(d.sala), { sz: 7.5 });
    y += rh;
    cell(doc, ML,         y, tecW, rh, '', { bg: '#FAFAFA' });
    cell(doc, ML+tecW+4,  y, datW/2, rh, 'Equipo', { bg: BL_L, bold: true, sz: 7 });
    cell(doc, ML+tecW+4+datW/2, y, datW/2, rh, v(d.equipo), { sz: 7.5 });
    y += rh;
    cell(doc, ML,         y, tecW, rh, '', { bg: '#FAFAFA' });
    cell(doc, ML+tecW+4,  y, datW/2, rh, 'Marca',  { bg: BL_L, bold: true, sz: 7 });
    cell(doc, ML+tecW+4+datW/2, y, datW/2, rh, v(d.marca), { sz: 7.5 });
    y += rh;
    cell(doc, ML,         y, tecW, rh, '', { bg: '#FAFAFA' });
    cell(doc, ML+tecW+4,  y, datW/2, rh, 'Modelo', { bg: BL_L, bold: true, sz: 7 });
    cell(doc, ML+tecW+4+datW/2, y, datW/2, rh, v(d.modelo), { sz: 7.5 });
    y += rh + 4;

    // ── RESUMEN ──
    y = secHdr(doc, y, 'RESUMEN DE ACTIVIDAD');
    const half = (W - 6) / 2;
    const r1 = v(d.resumen1) === '—' ? '' : v(d.resumen1);
    const r2 = v(d.resumen2) === '—' ? '' : v(d.resumen2);
    const resH = Math.max(40,
      Math.max(
        doc.heightOfString(r1 || ' ', { width: half - 8 }),
        doc.heightOfString(r2 || ' ', { width: half - 8 })
      ) + 12
    );
    rct(doc, ML,        y, half, resH, '#FAFAFA', BORDER);
    rct(doc, ML+half+6, y, half, resH, '#FAFAFA', BORDER);
    doc.save().font('Helvetica').fontSize(8).fillColor('#333')
       .text(r1 || ' ', ML + 4, y + 6, { width: half - 8, lineBreak: true }).restore();
    doc.save().font('Helvetica').fontSize(8).fillColor('#333')
       .text(r2 || ' ', ML+half+10, y + 6, { width: half - 8, lineBreak: true }).restore();
    y += resH + 4;

    // ── FOTOS ──
    const photos   = (d.photos   || []).filter(Boolean);
    const captions = d.captions || [];
    if (photos.length > 0) {
      doc.addPage();
      y = 36;
      y = secHdr(doc, y, 'REGISTRO FOTOGRÁFICO');
      y += 6;

      const photoW = (W - 10) / 2;
      const photoH = photoW * 0.75;

      for (let i = 0; i < photos.length; i += 2) {
        if (y + photoH + 30 > 806) { doc.addPage(); y = 36; }
        for (let col = 0; col < 2; col++) {
          const idx = i + col;
          if (idx >= photos.length) break;
          const px = ML + col * (photoW + 10);
          try {
            const base64 = photos[idx].replace(/^data:image\/\w+;base64,/, '');
            const buf = Buffer.from(base64, 'base64');
            rct(doc, px, y, photoW, photoH, '#f5f5f5', BORDER);
            doc.image(buf, px + 2, y + 2, { fit: [photoW - 4, photoH - 4], align: 'center', valign: 'center' });
          } catch {
            rct(doc, px, y, photoW, photoH, '#f5f5f5', BORDER);
          }
          const cap = captions[idx] || `Fig. ${idx + 1}`;
          doc.save().font('Helvetica').fontSize(7).fillColor('#555')
             .text(cap, px, y + photoH + 2, { width: photoW, align: 'center' }).restore();
        }
        y += photoH + 18;
      }
    }

    doc.end();
  });
}

module.exports = { buildPdf };
