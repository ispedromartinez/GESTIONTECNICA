const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        ImageRun, AlignmentType, WidthType, BorderStyle, ShadingType,
        VerticalAlign } = require('docx');

async function buildDocxWom(d) {
  const v = s => (s || '').toString().trim();

  const HDR_L  = 5616;
  const HDR_R  = 5020;
  const OT_COL = 2510;
  const LBL_W  = 1911;
  const VAL_W  = 8453;
  const FULL_W = LBL_W + VAL_W;
  const TEC_W  = 5067;
  const DAT_LBL = 1199;
  const DAT_VAL = 9165;
  const RES_L  = 5171;
  const RES_R  = 5245;
  const RES_W  = RES_L + RES_R;

  const BLU = '1F497D';
  const WHT = 'FFFFFF';
  const GRN = '008000';
  const BLK = '000000';

  const thin   = () => ({ style: BorderStyle.SINGLE, size: 4, color: 'auto' });
  const noneB  = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  const brd    = { top: thin(), bottom: thin(), left: noneB, right: thin() };
  const tblBrd = { top: thin(), bottom: thin(), left: noneB, right: thin(), insideH: thin(), insideV: thin() };
  const noBrd  = { top: noneB, bottom: noneB, left: noneB, right: noneB };
  const noTblBrd = { top: noneB, bottom: noneB, left: noneB, right: noneB, insideH: noneB, insideV: noneB };

  const para = (children, align = 'left', before = 0) => new Paragraph({
    alignment: align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before, after: 0 },
    children: Array.isArray(children) ? children : [children]
  });
  const run = (text, opts = {}) => new TextRun({
    text: text || '', size: opts.sz || 18, font: 'Calibri',
    bold: !!opts.bold, italics: !!opts.it, color: opts.c || BLK
  });

  const otCell = (text, w, opts = {}) => new TableCell({
    width: { size: w, type: WidthType.DXA }, borders: brd,
    verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 14, right: 14 },
    children: [para(run(text, opts), 'center', 110)]
  });
  const otBlu = (text, w, span, sz) => new TableCell({
    width: { size: w, type: WidthType.DXA }, ...(span > 1 ? { columnSpan: span } : {}),
    borders: brd, shading: { fill: BLU, type: ShadingType.CLEAR },
    verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children: [para(run(text, { bold: true, sz, c: WHT }), 'center', sz === 30 ? 284 : 110)]
  });
  const otCod = (codVal, w) => new TableCell({
    width: { size: w, type: WidthType.DXA }, borders: brd,
    verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 14, right: 14 },
    children: [para(codVal
      ? run(`INC-${codVal}`, { bold: true, c: GRN, sz: 18 })
      : run('', { sz: 18 }),
    'center', 110)]
  });

  const otTable = new Table({
    width: { size: HDR_R, type: WidthType.DXA }, columnWidths: [OT_COL, OT_COL], borders: tblBrd,
    indent: { size: 0, type: WidthType.DXA },
    rows: [
      new TableRow({ height: { value: 558 }, children: [otBlu('ORDEN DE TRABAJO', OT_COL * 2, 2, 30)] }),
      new TableRow({ height: { value: 404 }, children: [otCell('Código Interno', OT_COL), otCod(v(d.codInterno), OT_COL)] }),
      new TableRow({ height: { value: 404 }, children: [otCell('Ticket', OT_COL), otCell(v(d.ticket), OT_COL, { bold: true })] }),
      new TableRow({ height: { value: 404 }, children: [otBlu('Fecha OT', OT_COL * 2, 2, 18)] }),
      new TableRow({ height: { value: 393 }, children: [otCell('Inicio:', OT_COL), otCell(`${v(d.fechaInicio)}  ${v(d.horaInicio)}`, OT_COL)] }),
      new TableRow({ height: { value: 371 }, children: [otCell('Término:', OT_COL), otCell(`${v(d.fechaTermino)}  ${v(d.horaTermino)}`, OT_COL)] })
    ]
  });

  let icetelLogo = null, womLogo = null;
  try { const p = path.join(__dirname, '..', 'assets', 'icetel-logo.jpeg'); if (fs.existsSync(p)) icetelLogo = fs.readFileSync(p); } catch (e) {}
  try { const p = path.join(__dirname, '..', 'assets', 'wom-logo.png');     if (fs.existsSync(p)) womLogo    = fs.readFileSync(p); } catch (e) {}

  const logoParas = [];
  if (icetelLogo) logoParas.push(para(new ImageRun({ data: icetelLogo, transformation: { width: 314, height: 175 } }), 'left', 0));
  if (womLogo) logoParas.push(new Paragraph({
    spacing: { before: 40, after: 0 }, indent: { left: 420 },
    children: [new ImageRun({ data: womLogo, transformation: { width: 220, height: 102 } })]
  }));
  if (!logoParas.length) logoParas.push(para(run('ICETEL / WOM', { bold: true, sz: 20 }), 'left', 0));

  const logoCell = new TableCell({
    width: { size: HDR_L, type: WidthType.DXA }, borders: noBrd,
    verticalAlign: VerticalAlign.TOP, margins: { top: 40, bottom: 40, left: 0, right: 40 },
    children: logoParas
  });
  const otCellHdr = new TableCell({
    width: { size: HDR_R, type: WidthType.DXA }, borders: noBrd,
    verticalAlign: VerticalAlign.TOP, margins: { top: 0, bottom: 0, left: 0, right: 0 },
    children: [otTable]
  });
  const hdrTable = new Table({
    width: { size: HDR_L + HDR_R, type: WidthType.DXA }, columnWidths: [HDR_L, HDR_R],
    borders: noTblBrd,
    rows: [new TableRow({ children: [logoCell, otCellHdr] })]
  });

  const bluCell = (text, w, span = 1) => new TableCell({
    width: { size: w, type: WidthType.DXA }, ...(span > 1 ? { columnSpan: span } : {}),
    borders: brd, shading: { fill: BLU, type: ShadingType.CLEAR },
    verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 100, right: 80 },
    children: [para(run(text, { bold: true, sz: 18, c: WHT }))]
  });
  const valCell = (text, w, opts = {}) => new TableCell({
    width: { size: w, type: WidthType.DXA }, borders: brd,
    verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 100, right: 60 },
    children: [para(run(text, { sz: 18, bold: opts.bold || false, c: opts.c || BLK }))]
  });
  const whtCell = (text, w) => new TableCell({
    width: { size: w, type: WidthType.DXA }, borders: brd,
    shading: { fill: WHT, type: ShadingType.CLEAR },
    verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 100, right: 60 },
    children: [para(run(text, { bold: true }))]
  });
  const multiCell = (paragraphs, w) => new TableCell({
    width: { size: w, type: WidthType.DXA }, borders: brd,
    margins: { top: 60, bottom: 60, left: 100, right: 80 }, children: paragraphs
  });

  const bodyTable = new Table({
    width: { size: FULL_W, type: WidthType.DXA }, columnWidths: [LBL_W, VAL_W], borders: tblBrd,
    rows: [
      new TableRow({ height: { value: 404 }, children: [bluCell('Cliente', LBL_W),         valCell('WOM', VAL_W, { bold: true })] }),
      new TableRow({ height: { value: 404 }, children: [bluCell('Sistemas', LBL_W),         valCell(v(d.infraestructura), VAL_W)] }),
      new TableRow({ height: { value: 404 }, children: [bluCell('Tipo de actividad', LBL_W), valCell(v(d.tipoActividad), VAL_W)] }),
      new TableRow({ height: { value: 404 }, children: [bluCell('Instalación', LBL_W),      valCell(v(d.instalacion), VAL_W)] }),
      new TableRow({ height: { value: 404 }, children: [bluCell('Dirección', LBL_W),        valCell(v(d.direccion), VAL_W)] })
    ]
  });

  const trabajosParas = (v(d.trabajos) || '').split('\n').filter(l => l.trim())
    .map(line => new Paragraph({ spacing: { before: 0, after: 60 }, children: [run(line.trim())] }));
  if (!trabajosParas.length) trabajosParas.push(new Paragraph({ spacing: { before: 0, after: 0 }, children: [run('')] }));
  const trabajosTable = new Table({
    width: { size: FULL_W, type: WidthType.DXA }, columnWidths: [FULL_W], borders: tblBrd,
    rows: [
      new TableRow({ height: { value: 404 }, children: [bluCell('Trabajos Realizados', FULL_W)] }),
      new TableRow({ height: { value: Math.max(608, trabajosParas.length * 300) }, children: [multiCell(trabajosParas, FULL_W)] })
    ]
  });

  const obsTable = new Table({
    width: { size: FULL_W, type: WidthType.DXA }, columnWidths: [FULL_W], borders: tblBrd,
    rows: [
      new TableRow({ height: { value: 404 }, children: [bluCell('Observaciones', FULL_W)] }),
      new TableRow({ height: { value: 404 }, children: [multiCell(
        [para(run(v(d.observaciones) || 'Sin observaciones adicionales'))], FULL_W
      )] })
    ]
  });

  const emptyTable = new Table({
    width: { size: FULL_W, type: WidthType.DXA }, columnWidths: [FULL_W], borders: tblBrd,
    rows: [new TableRow({ height: { value: 150 }, children: [
      new TableCell({ width: { size: FULL_W, type: WidthType.DXA }, borders: brd, children: [para(run(''))] })
    ]})]
  });

  const tecNames = (d.tecnicos || []).filter(Boolean);
  const tecTable = new Table({
    width: { size: TEC_W, type: WidthType.DXA }, columnWidths: [TEC_W], borders: tblBrd,
    rows: [
      new TableRow({ height: { value: 404 }, children: [bluCell('Técnico(s) Responsable(s)', TEC_W)] }),
      new TableRow({ height: { value: 404 }, children: [new TableCell({
        width: { size: TEC_W, type: WidthType.DXA }, borders: brd,
        verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 100, right: 60 },
        children: [para([run('Nombre y Apellido:  ', { bold: true }), run(tecNames.join('    /    '))])]
      })] })
    ]
  });

  const datTable = new Table({
    width: { size: FULL_W, type: WidthType.DXA }, columnWidths: [DAT_LBL, DAT_VAL], borders: tblBrd,
    rows: [
      new TableRow({ height: { value: 404 }, children: [
        new TableCell({ width: { size: FULL_W, type: WidthType.DXA }, columnSpan: 2, borders: brd,
          shading: { fill: BLU, type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER,
          margins: { top: 40, bottom: 40, left: 100, right: 80 },
          children: [para(run('Datos generales:', { bold: true, c: WHT }))] })
      ]}),
      new TableRow({ height: { value: 404 }, children: [whtCell('Sala:', DAT_LBL),   valCell(v(d.sala), DAT_VAL)] }),
      new TableRow({ height: { value: 404 }, children: [whtCell('Equipo:', DAT_LBL), valCell(v(d.equipo), DAT_VAL)] }),
      new TableRow({ height: { value: 404 }, children: [whtCell('Marca:', DAT_LBL),  valCell(v(d.marca), DAT_VAL)] }),
      new TableRow({ height: { value: 404 }, children: [whtCell('Modelo:', DAT_LBL), valCell(v(d.modelo), DAT_VAL)] })
    ]
  });

  const photos   = d.photos   || [];
  const captions = d.captions || [];

  const mkPhotoCell = (b64, w) => {
    if (!b64) return new TableCell({ width: { size: w, type: WidthType.DXA }, borders: brd,
      verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 40, right: 40 },
      children: [para(run(''))] });
    try {
      const buf = Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      return new TableCell({ width: { size: w, type: WidthType.DXA }, borders: brd,
        verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 40, right: 40 },
        children: [para(new ImageRun({ data: buf, transformation: { width: 235, height: 175 } }), 'center')] });
    } catch (e) {
      return new TableCell({ width: { size: w, type: WidthType.DXA }, borders: brd,
        children: [para(run('[error foto]', { sz: 14 }))] });
    }
  };
  const mkCapCell = (idx, w) => new TableCell({
    width: { size: w, type: WidthType.DXA }, borders: brd,
    verticalAlign: VerticalAlign.CENTER, margins: { top: 30, bottom: 30, left: 100, right: 60 },
    children: [para(run(captions[idx] || '', { sz: 16, it: true }))]
  });

  const resRows = [
    new TableRow({ height: { value: 394 }, children: [
      new TableCell({ width: { size: RES_W, type: WidthType.DXA }, columnSpan: 2, borders: brd,
        shading: { fill: BLU, type: ShadingType.CLEAR }, verticalAlign: VerticalAlign.CENTER,
        margins: { top: 40, bottom: 40, left: 100, right: 80 },
        children: [para(run('RESUMEN DE ACTIVIDAD:', { bold: true, c: WHT }))] })
    ]}),
    new TableRow({ height: { value: 414 }, children: [
      new TableCell({ width: { size: RES_L, type: WidthType.DXA }, borders: brd,
        margins: { top: 40, bottom: 40, left: 100, right: 60 }, children: [para(run(v(d.resumen1)))] }),
      new TableCell({ width: { size: RES_R, type: WidthType.DXA }, borders: brd,
        margins: { top: 40, bottom: 40, left: 100, right: 60 }, children: [para(run(v(d.resumen2)))] })
    ]})
  ];

  for (let i = 0; i < Math.min(photos.length, 8); i += 2) {
    const ph = i === 0 ? 3231 : 3826;
    resRows.push(new TableRow({ height: { value: ph }, children: [
      mkPhotoCell(photos[i] || null, RES_L), mkPhotoCell(photos[i + 1] || null, RES_R)
    ]}));
    resRows.push(new TableRow({ height: { value: 458 }, children: [
      mkCapCell(i, RES_L), mkCapCell(i + 1, RES_R)
    ]}));
  }

  const resTable = new Table({
    width: { size: RES_W, type: WidthType.DXA }, columnWidths: [RES_L, RES_R], borders: tblBrd, rows: resRows
  });

  const gap = new Paragraph({ spacing: { before: 0, after: 60 }, children: [] });
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 720, right: 708, bottom: 280, left: 566 },
          size: { width: 11910, height: 16840 }
        }
      },
      children: [
        hdrTable, gap,
        bodyTable, gap,
        trabajosTable, gap,
        obsTable, gap,
        emptyTable, gap,
        tecTable, gap,
        datTable, gap,
        resTable
      ]
    }]
  });
  return await Packer.toBuffer(doc);
}

module.exports = { buildDocxWom };
