const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        ImageRun, AlignmentType, WidthType, BorderStyle, ShadingType,
        VerticalAlign, Header } = require('docx');

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  : null;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'documentos-word';

const app = express();
app.use(cors());
app.use(express.json({ limit: '80mb' }));
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'informe_clima_app.html')));

const DOCS_DIR      = path.join(__dirname, 'informes');
const PAPELERA_DIR  = path.join(__dirname, 'papelera');
const DB_FILE       = path.join(__dirname, 'registro.json');
const PAPELERA_FILE = path.join(__dirname, 'papelera.json');

if (!fs.existsSync(DOCS_DIR))     fs.mkdirSync(DOCS_DIR);
if (!fs.existsSync(PAPELERA_DIR)) fs.mkdirSync(PAPELERA_DIR);
if (!fs.existsSync(DB_FILE))      fs.writeFileSync(DB_FILE, '[]');
if (!fs.existsSync(PAPELERA_FILE))fs.writeFileSync(PAPELERA_FILE, '[]');

function loadDB()       { try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }       catch { return []; } }
function saveDB(d)      { fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); }
function loadPapelera() { try { return JSON.parse(fs.readFileSync(PAPELERA_FILE,'utf8')); } catch { return []; } }
function savePapelera(d){ fs.writeFileSync(PAPELERA_FILE, JSON.stringify(d, null, 2)); }

// Logo base64 embedded
const LOGO_B64 = fs.readFileSync(path.join(__dirname, 'logo.jpeg'), null) || null;

// ── Design tokens (matching original exactly) ─────────────
const BL  = 'DEEAF6';   // azul claro — celdas etiqueta
const BL2 = 'D9E2F3';   // azul medio — sub-headers
const GH  = 'D9D9D9';   // gris — headers sección
const BC  = '7B7B7B';   // color borde
const TW  = 9869;       // ancho tabla principal (igual al header original)

// Borders: thin=4 (like original sz:4), used everywhere
const thinB = (color=BC) => ({ style: BorderStyle.SINGLE, size: 12, color });
const allThin = { top: thinB(), bottom: thinB(), left: thinB(), right: thinB() };

const mkPara = (text, opts={}) => new Paragraph({
  alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
  spacing: { before: 0, after: 0 },
  children: [new TextRun({
    text: text || '', bold: opts.bold||false, italics: opts.italics||false,
    size: opts.sz || 18, font: 'Calibri', color: opts.color||'000000'
  })]
});

// Label cell (blue bg)
const LC = (text, w, span=1, fill=BL) => new TableCell({
  width: { size: w, type: WidthType.DXA },
  ...(span > 1 ? { columnSpan: span } : {}),
  borders: allThin,
  shading: { fill, type: ShadingType.CLEAR },
  verticalAlign: VerticalAlign.CENTER,
  margins: { top: 40, bottom: 40, left: 70, right: 40 },
  children: [mkPara(text, { bold: true, sz: 16 })]
});

// Value cell (white)
const VC = (text, w, span=1) => new TableCell({
  width: { size: w, type: WidthType.DXA },
  ...(span > 1 ? { columnSpan: span } : {}),
  borders: allThin,
  verticalAlign: VerticalAlign.CENTER,
  margins: { top: 40, bottom: 40, left: 70, right: 40 },
  children: [mkPara(text || '', { sz: 16, center: true })]
});

// Column header cell (blue2 bg, centered, bold)
const HC = (text, w, span=1, rowSpan=1) => new TableCell({
  width: { size: w, type: WidthType.DXA },
  ...(span > 1 ? { columnSpan: span } : {}),
  ...(rowSpan > 1 ? { rowSpan } : {}),
  borders: allThin,
  shading: { fill: BL2, type: ShadingType.CLEAR },
  verticalAlign: VerticalAlign.CENTER,
  margins: { top: 30, bottom: 30, left: 30, right: 30 },
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    children: [new TextRun({ text: text||'', bold: true, size: 14, font: 'Calibri' })]
  })]
});

// Section header row (full-width gray, ALL CAPS bold)
const secRow = (text) => new TableRow({
  height: { value: 300 },
  children: [new TableCell({
    width: { size: TW, type: WidthType.DXA }, columnSpan: 14,
    borders: allThin,
    shading: { fill: GH, type: ShadingType.CLEAR },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 40, bottom: 40, left: 100, right: 40 },
    children: [mkPara(text, { bold: true, sz: 18 })]
  })]
});

// ── Build DOCX ─────────────────────────────────────────────
async function buildDocx(d) {
  const v = s => (s||'').toString().trim() || 'N/A';
  // Separa el resumen por punto seguido de espacio, cada oración en su propia viñeta
  const splitSentences = text => {
    if (!text || text.trim() === 'N/A') return [text || 'N/A'];
    const parts = text.split(/(?<=\.)\s+/).map(s => s.trim()).filter(Boolean);
    return parts.length > 1 ? parts : [text.trim()];
  };
  const mkBullet = text => new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 0, after: 60 },
    children: [new TextRun({ text: text || '', size: 16, font: 'Calibri', color: '000000' })]
  });

  // ── HEADER with logo ──────────────────────────────────
  const HDR_BLUE  = '1A3A6C';   // azul corporativo ICETEL
  const HDR_BLUE2 = 'D6E4F0';   // azul claro etiquetas COD/FECHA
  const HDR_BRD   = '1A3A6C';   // borde header
  const thinHdr   = (color=HDR_BRD) => ({ style: BorderStyle.SINGLE, size: 12, color });
  const allHdr    = { top: thinHdr(), bottom: thinHdr(), left: thinHdr(), right: thinHdr() };

  let headerChildren = [];
  try {
    // Intenta logo.png primero, luego logo.jpeg como respaldo
    let logoPath = path.join(__dirname, 'logo.png');
    let logoType = 'png';
    if (!fs.existsSync(logoPath)) { logoPath = path.join(__dirname, 'logo.jpeg'); logoType = 'jpeg'; }
    const logoData = fs.readFileSync(logoPath);
    const headerTable = new Table({
      width: { size: TW, type: WidthType.DXA },
      columnWidths: [2563, 4625, 745, 1936],
      borders: {
        top: thinHdr(), bottom: thinHdr(),
        left: thinHdr(), right: thinHdr(),
        insideH: thinHdr(), insideV: thinHdr()
      },
      rows: [
        // Row 1: Logo | CENTRALES CLIMA | COD. | value
        new TableRow({
          height: { value: 450 },
          children: [
            // Logo cell — fondo blanco
            new TableCell({
              width: { size: 2563, type: WidthType.DXA },
              rowSpan: 2,
              borders: allHdr,
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 30, bottom: 30, left: 60, right: 60 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new ImageRun({ data: logoData, transformation: { width: 120, height: 65 }, type: logoType })]
              })]
            }),
            // Title cell — azul corporativo, texto blanco
            new TableCell({
              width: { size: 4625, type: WidthType.DXA },
              borders: allHdr,
              shading: { fill: HDR_BLUE, type: ShadingType.CLEAR },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 20, bottom: 20, left: 70, right: 40 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: 'CENTRALES CLIMA', bold: true, size: 24, font: 'Calibri', color: 'FFFFFF' })]
              })]
            }),
            // COD label
            new TableCell({
              width: { size: 745, type: WidthType.DXA },
              borders: allHdr,
              shading: { fill: HDR_BLUE2, type: ShadingType.CLEAR },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 20, bottom: 20, left: 40, right: 40 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: 'COD.', bold: true, size: 16, font: 'Calibri', color: HDR_BLUE })]
              })]
            }),
            // COD value
            new TableCell({
              width: { size: 1936, type: WidthType.DXA },
              borders: allHdr,
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 20, bottom: 20, left: 40, right: 40 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: v(d.codInforme), size: 16, font: 'Calibri', bold: true })]
              })]
            }),
          ]
        }),
        // Row 2: (logo merged) | INFORME CORRECTIVO CLIMA | FECHA | value
        new TableRow({
          height: { value: 360 },
          children: [
            new TableCell({
              width: { size: 4625, type: WidthType.DXA },
              borders: allHdr,
              shading: { fill: HDR_BLUE, type: ShadingType.CLEAR },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 20, bottom: 20, left: 70, right: 40 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: 'INFORME CORRECTIVO CLIMA', bold: true, size: 22, font: 'Calibri', color: 'FFFFFF' })]
              })]
            }),
            new TableCell({
              width: { size: 745, type: WidthType.DXA },
              borders: allHdr,
              shading: { fill: HDR_BLUE2, type: ShadingType.CLEAR },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 20, bottom: 20, left: 40, right: 40 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: 'FECHA', bold: true, size: 16, font: 'Calibri', color: HDR_BLUE })]
              })]
            }),
            new TableCell({
              width: { size: 1936, type: WidthType.DXA },
              borders: allHdr,
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 20, bottom: 20, left: 40, right: 40 },
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: v(d.fecha), size: 16, font: 'Calibri' })]
              })]
            }),
          ]
        })
      ]
    });
    headerChildren = [headerTable, new Paragraph({ spacing: { before: 0, after: 0 }, children: [] })];
  } catch(e) {
    console.log('Logo not found, skipping:', e.message);
    headerChildren = [new Paragraph({ children: [] })];
  }

  // ── MAIN TABLE ────────────────────────────────────────
  // Col widths matching original exactly (14 cols summing to TW=9869)
  // Proportionally scaled from 11231 → 9869
  const scale = 9869 / 11231;
  const cw = [2827,517,528,782,269,1056,1050,262,787,527,523,790,261,1052];
  const scaled = cw.map(w => Math.round(w * scale));
  // Fix rounding to sum exactly to TW
  const diff = TW - scaled.reduce((a,b)=>a+b,0);
  scaled[0] += diff;

  // ── INFO GENERAL ──────────────────────────────────────
  const row_ig = secRow('INFORMACION GENERAL');
  const row_sitio = new TableRow({ height:{value:280}, children:[
    LC('Nombre de Sitio', scaled[0]+scaled[1], 2),
    VC(v(d.nombreSitio), scaled[2]+scaled[3]+scaled[4]+scaled[5], 4),
    LC('Código de Sitio', scaled[6]+scaled[7]+scaled[8]+scaled[9], 4),
    VC(v(d.codigoSitio), scaled[10]+scaled[11]+scaled[12]+scaled[13], 4)
  ]});
  const row_dir = new TableRow({ height:{value:280}, children:[
    LC('Dirección', scaled[0]+scaled[1], 2),
    VC(v(d.direccion), TW-(scaled[0]+scaled[1]), 12)
  ]});

  const w_tk_label = scaled[0]+scaled[1];
  const w_tk_inc   = scaled[2]+scaled[3];
  const w_tk_te    = scaled[4]+scaled[5];
  const w_tk_ti    = scaled[6]+scaled[7];
  const w_tk_red   = scaled[8]+scaled[9];
  const w_tk_ot    = scaled[10]+scaled[11];
  const w_tk_otv   = scaled[12]+scaled[13];

  const row_tk = new TableRow({ height:{value:280}, children:[
    new TableCell({ width:{size:w_tk_label,type:WidthType.DXA}, columnSpan:2, rowSpan:2,
      borders:allThin, shading:{fill:BL,type:ShadingType.CLEAR},
      verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:70,right:40},
      children:[mkPara('Números de Tickets',{bold:true,sz:16})] }),
    LC('Inc.', w_tk_inc, 2, BL2), LC('TE', w_tk_te, 2, BL2),
    LC('TI', w_tk_ti, 2, BL2), LC('RED', w_tk_red, 2, BL2),
    LC('Numero de OT', w_tk_ot, 2, BL2), VC('', w_tk_otv, 2)
  ]});
  const row_tk2 = new TableRow({ height:{value:260}, children:[
    VC(v(d.ticketInc), w_tk_inc, 2), VC(v(d.ticketTE), w_tk_te, 2),
    VC(v(d.ticketTI), w_tk_ti, 2), VC(v(d.ticketRED), w_tk_red, 2),
    new TableCell({ width:{size:w_tk_ot,type:WidthType.DXA}, columnSpan:2,
      borders:allThin, shading:{fill:BL2,type:ShadingType.CLEAR},
      verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:40,right:40},
      children:[mkPara('')] }),
    VC(v(d.numOT), w_tk_otv, 2)
  ]});

  const row_sala = new TableRow({ height:{value:280}, children:[
    LC('Sala', w_tk_label, 2),
    VC(v(d.sala), w_tk_inc+w_tk_te+w_tk_ti+w_tk_red, 8),
    LC('Fecha Ejecución', w_tk_ot, 2, BL2),
    VC(v(d.fecha), w_tk_otv, 2)
  ]});
  const row_tec = new TableRow({ height:{value:280}, children:[
    LC('Técnico Ejecutante', w_tk_label, 2),
    VC(v(d.tecnico), w_tk_inc+w_tk_te, 4),
    LC('Supervisor', w_tk_ti+w_tk_red, 4),
    VC(v(d.supervisor), w_tk_ot+w_tk_otv, 4)
  ]});

  // ── RESUMEN ───────────────────────────────────────────
  const row_rs = secRow('RESUMEN DE LA ACTIVIDAD');
  const row_rs2 = new TableRow({ height:{value:2200}, children:[
    new TableCell({ width:{size:TW,type:WidthType.DXA}, columnSpan:14,
      borders:allThin, margins:{top:60,bottom:60,left:100,right:100},
      children: splitSentences(v(d.resumen)).map(linea => mkBullet(linea)) })
  ]});

  // ── EQUIPAMIENTO ─────────────────────────────────────
  const row_eq  = secRow('DATOS GENERALES DEL EQUIPAMIENTO');
  const w_eq1 = Math.round(TW*0.23), w_eq2 = Math.round(TW*0.17), w_eq3 = Math.round(TW*0.19),
        w_eq4 = Math.round(TW*0.22), w_eq5 = TW - w_eq1 - w_eq2 - w_eq3 - w_eq4;
  const row_eq_h = new TableRow({ height:{value:280}, children:[
    HC('Sala',w_eq1,1), HC('N° Equipo',w_eq2,4), HC('Tipo',w_eq3,2),
    HC('Marca',w_eq4,4), HC('Modelo / Serie',w_eq5,3)
  ]});
  const row_eq_d = new TableRow({ height:{value:280}, children:[
    VC(v(d.eqSala),w_eq1,1), VC(v(d.eqNumero),w_eq2,4),
    VC(v(d.eqTipo),w_eq3,2), VC(v(d.eqMarca),w_eq4,4), VC(v(d.eqModelo),w_eq5,3)
  ]});

  // ── MEDICIONES ────────────────────────────────────────
  const row_med = secRow('MEDICIONES GENERALES');
  const mw = Math.floor(TW/14);
  const row_med_h1 = new TableRow({ height:{value:260}, children:[
    HC('N° De Equipo', mw*2, 1, 2),
    HC('Consumo Compresor COMP 1', mw*3, 4),
    HC('Consumo Evaporador', mw*2, 2),
    HC('Consumo Condensador', mw*3, 4),
    HC('Temperatura', TW - mw*2 - mw*3 - mw*2 - mw*3, 3)
  ]});
  const mw2 = Math.floor((mw*3)/2);
  const row_med_h2 = new TableRow({ height:{value:260}, children:[
    HC('V.Prom\n(Volt)', mw2, 2), HC('Corriente\n(Amp)', mw*3-mw2, 2),
    HC('V.Prom\n(Volt)', mw, 1), HC('Corriente\n(Amp)', mw, 1),
    HC('V.Prom\n(Volt)', mw2, 2), HC('Corriente\n(Amp)', mw*3-mw2, 2),
    HC('Inyección\n(°C)', mw, 2),
    HC('Retorno\n(°C)', TW - mw*2 - mw*3 - mw*2 - mw*3 - mw, 1)
  ]});
  const row_med_d = new TableRow({ height:{value:300}, children:[
    VC(v(d.eqNumero), mw*2, 1),
    VC(v(d.m_cv), mw2, 2), VC(v(d.m_ca), mw*3-mw2, 2),
    VC(v(d.m_ev), mw, 1), VC(v(d.m_ea), mw, 1),
    VC(v(d.m_condv), mw2, 2), VC(v(d.m_conda), mw*3-mw2, 2),
    VC(v(d.m_tinj), mw, 2),
    VC(v(d.m_tret), TW - mw*2 - mw*3 - mw*2 - mw*3 - mw, 1)
  ]});

  // ── OBSERVACIONES ─────────────────────────────────────
  const row_obs  = secRow('OBSERVACIONES Y RECOMENDACIONES');
  const row_obs2 = new TableRow({ height:{value:1400}, children:[
    new TableCell({ width:{size:TW,type:WidthType.DXA}, columnSpan:14,
      borders:allThin, margins:{top:60,bottom:60,left:100,right:100},
      children:[mkPara(v(d.observaciones),{sz:16})] })
  ]});

  // ── FOTOS — only rows with at least 1 photo ───────────
  const row_foto_hdr = secRow('REGISTRO FOTOGRAFICO');
  const photoRows = [];

  for (let r = 0; r < 6; r++) {
    const i1 = r*2, i2 = r*2+1;
    const p1 = d.photos && d.photos[i1];
    const p2 = d.photos && d.photos[i2];
    if (!p1 && !p2) continue; // skip empty rows entirely

    const cells = [];
    for (const [idx, photoData] of [[i1,p1],[i2,p2]]) {
      let children = [];
      if (photoData) {
        const base64 = photoData.replace(/^data:image\/\w+;base64,/, '');
        const imgBuf = Buffer.from(base64, 'base64');
        const ext = photoData.startsWith('data:image/png') ? 'png' : 'jpeg';
        // Image sized to fill cell nicely
        const descText = (d.photoDescs && d.photoDescs[idx]) ? d.photoDescs[idx] : `Fig. ${idx+1}`;
        children = [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0 },
            children: [new ImageRun({ data: imgBuf, transformation: { width: 210, height: 158 }, type: ext })]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 40, after: 0 },
            children: [new TextRun({ text: descText, italics: true, bold: true, size: 14, font: 'Calibri' })]
          })
        ];
      } else {
        // Empty slot — just label, no box/border fill
        children = [
          new Paragraph({ spacing:{before:0,after:0}, children:[new TextRun({text:'',size:14})] }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 20, after: 0 },
            children: [new TextRun({ text: `Fig. ${idx+1}`, italics: true, bold: true, size: 14, font: 'Calibri', color: 'CCCCCC' })]
          })
        ];
      }
      cells.push(new TableCell({
        width: { size: Math.floor(TW/2), type: WidthType.DXA },
        columnSpan: 7,
        borders: allThin,
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 40, bottom: 40, left: 60, right: 60 },
        children
      }));
    }
    photoRows.push(new TableRow({ height: { value: 2400 }, children: cells }));
  }

  const mainTable = new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: scaled,
    rows: [
      row_ig, row_sitio, row_dir, row_tk, row_tk2, row_sala, row_tec,
      row_rs, row_rs2,
      row_eq, row_eq_h, row_eq_d,
      row_med, row_med_h1, row_med_h2, row_med_d,
      row_obs, row_obs2,
    ]
  });

  const sectionChildren = [mainTable];

  if (photoRows.length > 0) {
    const photoTable = new Table({
      width: { size: TW, type: WidthType.DXA },
      columnWidths: scaled,
      rows: [row_foto_hdr, ...photoRows]
    });
    sectionChildren.push(
      new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0 }, children: [] }),
      photoTable
    );
  }

  const doc = new Document({
    sections: [{
      headers: { default: new Header({ children: headerChildren }) },
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1701, bottom: 1417, left: 1701, header: 284 }
        }
      },
      children: sectionChildren
    }]
  });

  return Packer.toBuffer(doc);
}

// ── Routes ────────────────────────────────────────────────
app.get('/ping', (req,res) => res.json({ok:true}));

app.get('/version', (req,res) => {
  try {
    const mtime = fs.statSync(path.join(__dirname, 'informe_clima_app.html')).mtimeMs;
    res.json({ v: mtime });
  } catch { res.json({ v: 0 }); }
});

app.post('/generar', async (req,res) => {
  try {
    const d = req.body;
    const buffer = await buildDocx(d);
    const sitePart = (d.nombreSitio||'Clima').replace(/[^a-zA-Z0-9]/g,'_').slice(0,25);
    const fname = `${d.codInforme||'Informe'}_${sitePart}.docx`;
    const fpath = path.join(DOCS_DIR, fname);
    fs.writeFileSync(fpath, buffer);

    if (supabase) {
      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(fname, buffer, {
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          upsert: true
        });
      if (uploadError) console.error('Supabase upload error:', uploadError.message);
    }

    const db = loadDB();
    const { photos, ...meta } = d;
    db.unshift({
      id: Date.now().toString(),
      fecha: d.fecha, fechaCreacion: new Date().toISOString(),
      codInforme: d.codInforme, nombreSitio: d.nombreSitio,
      codigoSitio: d.codigoSitio, tecnico: d.tecnico,
      supervisor: d.supervisor, numOT: d.numOT,
      photoCount: (photos||[]).filter(Boolean).length,
      filename: fname
    });
    saveDB(db);

    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition',`attachment; filename="${fname}"`);
    res.setHeader('Access-Control-Expose-Headers','Content-Disposition');
    res.send(buffer);
  } catch(err) { console.error(err); res.status(500).json({error:err.message}); }
});

app.get('/registro', (req,res) => {
  const db = loadDB();
  const q = (req.query.q||'').toLowerCase().trim();
  res.json(q ? db.filter(r =>
    (r.nombreSitio||'').toLowerCase().includes(q) ||
    (r.codInforme||'').toLowerCase().includes(q) ||
    (r.tecnico||'').toLowerCase().includes(q) ||
    (r.numOT||'').toLowerCase().includes(q)
  ) : db);
});

app.get('/descargar/:id', (req,res) => {
  const entry = loadDB().find(r=>r.id===req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  const fpath = path.join(DOCS_DIR, entry.filename);
  if (!fs.existsSync(fpath)) return res.status(404).json({error:'Archivo no existe'});
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition',`attachment; filename="${entry.filename}"`);
  res.sendFile(fpath);
});

app.post('/enviar/:id', async (req,res) => {
  const entry = loadDB().find(r=>r.id===req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  const fpath = path.join(DOCS_DIR, entry.filename);
  if (!fs.existsSync(fpath)) return res.status(404).json({error:'Archivo no existe'});
  const {to,smtpHost,smtpPort,smtpUser,smtpPass} = req.body;
  if (!to) return res.status(400).json({error:'Email requerido'});
  try {
    const t = nodemailer.createTransport({ host:smtpHost||'smtp.gmail.com', port:smtpPort||587, secure:false, auth:{user:smtpUser,pass:smtpPass} });
    await t.sendMail({ from:smtpUser, to, subject:`Informe - ${entry.nombreSitio} - ${entry.codInforme}`,
      text:`Adjunto informe.\nSitio: ${entry.nombreSitio}\nFecha: ${entry.fecha}\nTécnico: ${entry.tecnico}`,
      attachments:[{filename:entry.filename,path:fpath}] });
    res.json({ok:true});
  } catch(err){ res.status(500).json({error:err.message}); }
});

// Mover a papelera (soft delete)
app.delete('/registro/:id', (req,res) => {
  let db = loadDB();
  const entry = db.find(r => r.id === req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  const srcPath  = path.join(DOCS_DIR, entry.filename);
  const destPath = path.join(PAPELERA_DIR, entry.filename);
  try { if (fs.existsSync(srcPath)) fs.renameSync(srcPath, destPath); } catch(e) { console.error('move error:', e.message); }
  const papelera = loadPapelera();
  papelera.unshift({ ...entry, fechaEliminado: new Date().toISOString() });
  savePapelera(papelera);
  saveDB(db.filter(r => r.id !== req.params.id));
  res.json({ok:true});
});

// List papelera
app.get('/papelera', (req,res) => {
  const q = (req.query.q||'').toLowerCase().trim();
  const p = loadPapelera();
  res.json(q ? p.filter(r =>
    (r.nombreSitio||'').toLowerCase().includes(q) ||
    (r.codInforme||'').toLowerCase().includes(q) ||
    (r.tecnico||'').toLowerCase().includes(q)
  ) : p);
});

// Restore from papelera
app.post('/papelera/restaurar/:id', (req,res) => {
  let papelera = loadPapelera();
  const entry = papelera.find(r => r.id === req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  const srcPath  = path.join(PAPELERA_DIR, entry.filename);
  const destPath = path.join(DOCS_DIR, entry.filename);
  try { if (fs.existsSync(srcPath)) fs.renameSync(srcPath, destPath); } catch(e) { console.error('restore error:', e.message); }
  const { fechaEliminado, ...clean } = entry;
  const db = loadDB();
  db.unshift(clean);
  saveDB(db);
  savePapelera(papelera.filter(r => r.id !== req.params.id));
  res.json({ok:true});
});

// Delete permanently from papelera
app.delete('/papelera/:id', (req,res) => {
  let papelera = loadPapelera();
  const entry = papelera.find(r => r.id === req.params.id);
  if (!entry) return res.status(404).json({error:'No encontrado'});
  const fpath = path.join(PAPELERA_DIR, entry.filename);
  try { if (fs.existsSync(fpath)) fs.unlinkSync(fpath); } catch(e) {}
  savePapelera(papelera.filter(r => r.id !== req.params.id));
  res.json({ok:true});
});

// Empty entire papelera
app.delete('/papelera', (req,res) => {
  const papelera = loadPapelera();
  papelera.forEach(entry => {
    const fpath = path.join(PAPELERA_DIR, entry.filename);
    try { if (fs.existsSync(fpath)) fs.unlinkSync(fpath); } catch(e) {}
  });
  savePapelera([]);
  res.json({ok:true});
});

const PORT = 3000;
const os = require('os');
function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}
app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`✅ Servidor corriendo:`);
  console.log(`   PC:     http://localhost:${PORT}`);
  console.log(`   Celular (misma red WiFi): http://${ip}:${PORT}`);
  console.log(`   Informes guardados en: ./informes/`);
});
