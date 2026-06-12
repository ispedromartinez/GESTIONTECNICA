const PDFDocument = require('pdfkit');
const fs          = require('fs');
const path        = require('path');

const BLUE  = '#1A3A6C';
const BL_L  = '#D6E4F0';
const BL_R  = '#DEEAF6';
const BL_R2 = '#D9E2F3';
const GRAY  = '#D9D9D9';
const BORDER = '#9E9E9E';

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

function cell(doc, x, y, w, h, text, { bg = null, color = '#1a1a1a', bold = false,
                                        sz = 8, center = false, top = false } = {}) {
  rct(doc, x, y, w, h, bg || '#FFFFFF', BORDER);
  const pad = 4;
  const fw = w - pad * 2;
  const fn = bold ? 'Helvetica-Bold' : 'Helvetica';
  const str = String(text ?? '—');
  doc.save().font(fn).fontSize(sz).fillColor(color);
  const th = doc.heightOfString(str, { width: fw, align: center ? 'center' : 'left' });
  const ty = top ? y + pad : y + Math.max(pad, (h - th) / 2);
  doc.text(str, x + pad, ty, { width: fw, align: center ? 'center' : 'left', lineBreak: true });
  doc.restore();
}

function secHdr(doc, y, text) {
  const h = 18;
  rct(doc, ML, y, W, h, GRAY, BORDER);
  doc.save().font('Helvetica-Bold').fontSize(9).fillColor('#333')
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
    const hdrH = 50;
    try {
      let logoPath = path.join(__dirname, '..', 'logo.png');
      if (!fs.existsSync(logoPath)) logoPath = path.join(__dirname, '..', 'logo.jpeg');
      rct(doc, ML, y, W * 0.26, hdrH, '#FFFFFF', BORDER);
      doc.image(logoPath, ML + 4, y + 6, { fit: [W * 0.26 - 8, hdrH - 12], align: 'center', valign: 'center' });
    } catch {
      rct(doc, ML, y, W * 0.26, hdrH, '#FFFFFF', BORDER);
      doc.save().font('Helvetica-Bold').fontSize(10).fillColor(BLUE)
         .text('ICETEL', ML + 4, y + 18, { width: W * 0.26 - 8, align: 'center' }).restore();
    }
    const titleX = ML + W * 0.26;
    const titleW = W * 0.47;
    rct(doc, titleX, y, titleW, hdrH * 0.5, BLUE, BORDER);
    doc.save().font('Helvetica-Bold').fontSize(10).fillColor('#FFF')
       .text('CENTRALES CLIMA', titleX + 4, y + 5, { width: titleW - 8, align: 'center' }).restore();
    rct(doc, titleX, y + hdrH * 0.5, titleW, hdrH * 0.5, BLUE, BORDER);
    doc.save().font('Helvetica-Bold').fontSize(9).fillColor('#FFF')
       .text('INFORME CORRECTIVO CLIMA', titleX + 4, y + hdrH * 0.5 + 5, { width: titleW - 8, align: 'center' }).restore();
    const codX = ML + W * 0.73;
    const codW = W * 0.27;
    rct(doc, codX, y, codW, hdrH * 0.5, BL_L, BORDER);
    doc.save().font('Helvetica-Bold').fontSize(7).fillColor(BLUE)
       .text('COD.', codX + 4, y + 3, { width: codW / 2 - 4 })
       .font('Helvetica').fontSize(7.5).fillColor('#333')
       .text(v(d.codInforme), codX + codW / 2, y + 3, { width: codW / 2 - 4, align: 'right' }).restore();
    rct(doc, codX, y + hdrH * 0.5, codW, hdrH * 0.5, BL_L, BORDER);
    doc.save().font('Helvetica-Bold').fontSize(7).fillColor(BLUE)
       .text('FECHA', codX + 4, y + hdrH * 0.5 + 3, { width: codW / 2 - 4 })
       .font('Helvetica').fontSize(7.5).fillColor('#333')
       .text(v(d.fecha), codX + codW / 2, y + hdrH * 0.5 + 3, { width: codW / 2 - 4, align: 'right' }).restore();
    y += hdrH + 6;

    // ── INFORMACION GENERAL ──
    y = secHdr(doc, y, 'INFORMACION GENERAL');
    const c1 = W * 0.22, c2 = W * 0.28, c3 = W * 0.22, c4 = W * 0.28;
    cell(doc, ML,          y, c1, rh, 'Nombre de Sitio', { bg: BL_R, bold: true, sz: 7.5 });
    cell(doc, ML + c1,     y, c2, rh, v(d.nombreSitio),  { sz: 7.5 });
    cell(doc, ML + c1+c2,  y, c3, rh, 'Código de Sitio', { bg: BL_R, bold: true, sz: 7.5 });
    cell(doc, ML+c1+c2+c3, y, c4, rh, v(d.codigoSitio),  { sz: 7.5 });
    y += rh;
    cell(doc, ML,      y, c1, rh, 'Dirección', { bg: BL_R, bold: true, sz: 7.5 });
    cell(doc, ML + c1, y, W - c1, rh, v(d.direccion), { sz: 7.5 });
    y += rh;
    // Tickets row
    const tk = W / 6;
    cell(doc, ML,          y, tk, rh, 'Tickets',    { bg: BL_R, bold: true, sz: 7.5, center: true });
    cell(doc, ML+tk,       y, tk, rh, 'Inc.',       { bg: BL_R2, bold: true, sz: 7.5, center: true });
    cell(doc, ML+tk*2,     y, tk, rh, v(d.ticketInc), { sz: 7.5, center: true });
    cell(doc, ML+tk*3,     y, tk, rh, 'TE',         { bg: BL_R2, bold: true, sz: 7.5, center: true });
    cell(doc, ML+tk*4,     y, tk, rh, v(d.ticketTE), { sz: 7.5, center: true });
    cell(doc, ML+tk*5,     y, tk, rh, `TE: ${v(d.ticketTI)}`, { sz: 7, center: true });
    y += rh;
    cell(doc, ML,      y, tk,   rh, 'RED',     { bg: BL_R2, bold: true, sz: 7.5, center: true });
    cell(doc, ML+tk,   y, tk,   rh, v(d.ticketRED), { sz: 7.5, center: true });
    cell(doc, ML+tk*2, y, tk,   rh, 'Número OT', { bg: BL_R, bold: true, sz: 7.5, center: true });
    cell(doc, ML+tk*3, y, tk*3, rh, v(d.numOT),   { sz: 7.5, center: true });
    y += rh;
    const half = W / 2;
    cell(doc, ML,        y, c1,       rh, 'Sala',              { bg: BL_R, bold: true, sz: 7.5 });
    cell(doc, ML+c1,     y, c2,       rh, v(d.sala),           { sz: 7.5 });
    cell(doc, ML+c1+c2,  y, c3,       rh, 'Fecha Ejecución',   { bg: BL_R, bold: true, sz: 7.5 });
    cell(doc, ML+c1+c2+c3, y, c4,     rh, v(d.fecha),          { sz: 7.5 });
    y += rh;
    cell(doc, ML,        y, c1,       rh, 'Técnico Ejecutante', { bg: BL_R, bold: true, sz: 7.5 });
    cell(doc, ML+c1,     y, c2,       rh, v(d.tecnico),         { sz: 7.5 });
    cell(doc, ML+c1+c2,  y, c3,       rh, 'Supervisor',         { bg: BL_R, bold: true, sz: 7.5 });
    cell(doc, ML+c1+c2+c3, y, c4,     rh, v(d.supervisor),      { sz: 7.5 });
    y += rh + 4;

    // ── RESUMEN ──
    y = secHdr(doc, y, 'RESUMEN DE LA ACTIVIDAD');
    const resumenText = v(d.resumen);
    const resH = Math.max(60, doc.heightOfString(resumenText, { width: W - 12 }) + 12);
    rct(doc, ML, y, W, resH, '#FAFAFA', BORDER);
    doc.save().font('Helvetica').fontSize(8).fillColor('#333')
       .text(resumenText, ML + 6, y + 6, { width: W - 12, lineBreak: true }).restore();
    y += resH + 4;

    // ── EQUIPO ──
    y = secHdr(doc, y, 'DATOS GENERALES DEL EQUIPAMIENTO');
    const eq = [W*0.18, W*0.14, W*0.2, W*0.24, W - W*0.18 - W*0.14 - W*0.2 - W*0.24];
    cell(doc, ML,                    y, eq[0], rh, 'Sala',           { bg: BL_R2, bold: true, sz: 7.5, center: true });
    cell(doc, ML+eq[0],              y, eq[1], rh, 'N° Equipo',      { bg: BL_R2, bold: true, sz: 7.5, center: true });
    cell(doc, ML+eq[0]+eq[1],        y, eq[2], rh, 'Tipo',           { bg: BL_R2, bold: true, sz: 7.5, center: true });
    cell(doc, ML+eq[0]+eq[1]+eq[2],  y, eq[3], rh, 'Marca',          { bg: BL_R2, bold: true, sz: 7.5, center: true });
    cell(doc, ML+eq[0]+eq[1]+eq[2]+eq[3], y, eq[4], rh, 'Modelo/Serie', { bg: BL_R2, bold: true, sz: 7.5, center: true });
    y += rh;
    cell(doc, ML,                    y, eq[0], rh, v(d.eqSala),   { sz: 7.5, center: true });
    cell(doc, ML+eq[0],              y, eq[1], rh, v(d.eqNumero), { sz: 7.5, center: true });
    cell(doc, ML+eq[0]+eq[1],        y, eq[2], rh, v(d.eqTipo),   { sz: 7.5, center: true });
    cell(doc, ML+eq[0]+eq[1]+eq[2],  y, eq[3], rh, v(d.eqMarca),  { sz: 7.5, center: true });
    cell(doc, ML+eq[0]+eq[1]+eq[2]+eq[3], y, eq[4], rh, v(d.eqModelo), { sz: 7.5, center: true });
    y += rh + 4;

    // ── MEDICIONES ──
    y = secHdr(doc, y, 'MEDICIONES GENERALES');
    const mCols = [W*0.1, W*0.1, W*0.1, W*0.1, W*0.1, W*0.1, W*0.1, W*0.1, W*0.1, W*0.1];
    const mw = W / 9;
    const mh = 16;
    // Header row 1 (grouped)
    const groups = [
      { label: 'N° Equipo', w: mw, span: 1 },
      { label: 'Compresor COMP 1', w: mw * 2, span: 2 },
      { label: 'Evaporador', w: mw * 2, span: 2 },
      { label: 'Condensador', w: mw * 2, span: 2 },
      { label: 'Temperatura', w: W - mw * 7, span: 2 },
    ];
    let gx = ML;
    for (const g of groups) {
      cell(doc, gx, y, g.w, mh, g.label, { bg: BL_R2, bold: true, sz: 6.5, center: true });
      gx += g.w;
    }
    y += mh;
    // Header row 2 (sub-cols)
    const subCols = [
      [mw, 'N° Eq.'],
      [mw, 'V.Prom (V)'], [mw, 'Corriente (A)'],
      [mw, 'V.Prom (V)'], [mw, 'Corriente (A)'],
      [mw, 'V.Prom (V)'], [mw, 'Corriente (A)'],
      [mw, 'Inyec. (°C)'], [W - mw * 8, 'Retorno (°C)'],
    ];
    let sx = ML;
    for (const [sw, sl] of subCols) {
      cell(doc, sx, y, sw, mh, sl, { bg: BL_L, bold: true, sz: 6, center: true });
      sx += sw;
    }
    y += mh;
    // Data row
    const vals = [v(d.eqNumero), v(d.m_cv), v(d.m_ca), v(d.m_ev), v(d.m_ea), v(d.m_condv), v(d.m_conda), v(d.m_tinj), v(d.m_tret)];
    let dx = ML;
    for (let i = 0; i < subCols.length; i++) {
      cell(doc, dx, y, subCols[i][0], rh, vals[i], { sz: 7.5, center: true });
      dx += subCols[i][0];
    }
    y += rh + 4;

    // ── OBSERVACIONES ──
    y = secHdr(doc, y, 'OBSERVACIONES Y RECOMENDACIONES');
    const obsText = v(d.observaciones);
    const obsH = Math.max(50, doc.heightOfString(obsText, { width: W - 12 }) + 12);
    rct(doc, ML, y, W, obsH, '#FAFAFA', BORDER);
    doc.save().font('Helvetica').fontSize(8).fillColor('#333')
       .text(obsText, ML + 6, y + 6, { width: W - 12, lineBreak: true }).restore();
    y += obsH + 4;

    // ── FOTOS ──
    const photos = (d.photos || []).filter(Boolean);
    if (photos.length > 0) {
      doc.addPage();
      y = 36;
      y = secHdr(doc, y, 'REGISTRO FOTOGRAFICO');
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
          const desc = (d.photoDescs && d.photoDescs[idx]) ? d.photoDescs[idx] : `Fig. ${idx + 1}`;
          doc.save().font('Helvetica').fontSize(7).fillColor('#555')
             .text(desc, px, y + photoH + 2, { width: photoW, align: 'center' }).restore();
        }
        y += photoH + 18;
      }
    }

    doc.end();
  });
}

module.exports = { buildPdf };
