const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        ImageRun, AlignmentType, WidthType, BorderStyle, ShadingType,
        VerticalAlign, Header, TextDirection } = require('docx');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

async function buildDocxWom(d) {
  const v  = s => (s||'').toString().trim();

  // ── Medidas exactas del documento de referencia ──────────
  // Header: tabla exterior invisible, col izq (logos) + col der (ORDEN DE TRABAJO)
  const HDR_L   = 5616;   // col izquierda header (logos)
  const HDR_R   = 5020;   // col derecha header (ORDEN DE TRABAJO = 2×2510)
  const OT_COL  = 2510;   // columnas dentro de la mini-tabla OT

  // Cuerpo: 9 tablas independientes
  const LBL_W   = 1911;   // etiqueta azul (body)
  const VAL_W   = 8453;   // valor (body)
  const FULL_W  = LBL_W + VAL_W;   // 10364
  const TEC_W   = 5067;             // técnicos (media página)
  const DAT_LBL = 1199;
  const DAT_VAL = 9165;
  const RES_L   = 5171;   // resumen col izq
  const RES_R   = 5245;   // resumen col der (exacto del ref: 5171+5245=10416)
  const RES_W   = RES_L + RES_R;   // 10416

  // ── Colores ──────────────────────────────────────────────
  const BLU = '1F497D';
  const WHT = 'FFFFFF';
  const GRN = '008000';
  const BLK = '000000';

  // ── Bordes ───────────────────────────────────────────────
  const thin    = () => ({ style: BorderStyle.SINGLE, size: 4, color: 'auto' });
  const noneB   = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  // Blanco en vez de "none": Word/docx-preview muestran una linea guia (gridline)
  // para celdas sin ningun borde definido. Con un borde blanco real, nunca se ve.
  const whiteB  = () => ({ style: BorderStyle.SINGLE, size: 4, color: 'FFFFFF' });
  const brd     = { top:thin(), bottom:thin(), left:thin(), right:thin() };
  const tblBrd  = { top:thin(), bottom:thin(), left:thin(), right:thin(), insideH:thin(), insideV:thin() };
  const noBrd   = { top:whiteB(), bottom:whiteB(), left:whiteB(), right:whiteB() };
  const noTblBrd= { top:whiteB(), bottom:whiteB(), left:whiteB(), right:whiteB(), insideH:whiteB(), insideV:whiteB() };
  // La mini-tabla OT va anidada dentro de una celda del header con otra celda
  // (logos) más alta a su lado: docx-preview estira el borde izquierdo de la
  // tabla anidada hasta el alto de la fila completa. Sin borde izquierdo aquí
  // evita esa línea larga; el resto de tablas del cuerpo no están anidadas y sí
  // llevan los 4 bordes.
  const otBrd    = { top:thin(), bottom:thin(), left:noneB, right:thin() };
  const otTblBrdX= { top:thin(), bottom:thin(), left:noneB, right:thin(), insideH:thin(), insideV:thin() };

  // ── Helpers ──────────────────────────────────────────────
  const para = (children, align='left', before=0) => new Paragraph({
    alignment: align==='center' ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before, after: 0 },
    children: Array.isArray(children) ? children : [children]
  });
  const run = (text, opts={}) => new TextRun({
    text: text||'', size: opts.sz||18, font: 'Calibri',
    bold: !!opts.bold, italics: !!opts.it, color: opts.c||BLK
  });

  // Celda OT (texto centrado, sin relleno)
  const otCell = (text, w, opts={}) => new TableCell({
    width:{size:w,type:WidthType.DXA}, borders:otBrd,
    verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:14,right:14},
    children:[para(run(text,opts),'center',110)]
  });
  // Celda OT azul (ORDEN DE TRABAJO / Fecha OT)
  const otBlu = (text, w, span, sz) => new TableCell({
    width:{size:w,type:WidthType.DXA}, ...(span>1?{columnSpan:span}:{}),
    borders:otBrd, shading:{fill:BLU,type:ShadingType.CLEAR},
    verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:60,right:60},
    children:[para(run(text,{bold:true,sz,c:WHT}),'center',sz===30?284:110)]
  });
  // Celda código interno verde centrada
  const otCod = (codVal, w) => new TableCell({
    width:{size:w,type:WidthType.DXA}, borders:otBrd,
    verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:14,right:14},
    children:[para(codVal
      ? run(`INC-${codVal}`,{bold:true,c:GRN,sz:18})
      : run('',{sz:18}),
    'center',110)]
  });

  // Mini-tabla ORDEN DE TRABAJO — anidada, sin borde izquierdo (ver otBrd)
  const otTblBrd = otTblBrdX;
  const otTable = new Table({
    width:{size:HDR_R,type:WidthType.DXA}, columnWidths:[OT_COL,OT_COL], borders:otTblBrd,
    indent:{size:0,type:WidthType.DXA},
    rows:[
      // Alturas medidas en pixeles exactos del PDF de referencia (informe 1)
      // a 96dpi (1px = 15 twips): 45,31,32,30,30,29 px de alto por fila.
      new TableRow({height:{value:675},children:[otBlu('ORDEN DE TRABAJO',OT_COL*2,2,30)]}),
      new TableRow({height:{value:465},children:[
        otCell('Código Interno',OT_COL), otCod(v(d.codInterno),OT_COL)
      ]}),
      new TableRow({height:{value:480},children:[
        otCell('Ticket',OT_COL), otCell(v(d.ticket),OT_COL,{bold:true})
      ]}),
      new TableRow({height:{value:450},children:[otBlu('Fecha OT',OT_COL*2,2,18)]}),
      new TableRow({height:{value:450},children:[
        otCell('Inicio:',OT_COL), otCell(`${v(d.fechaInicio)}  ${v(d.horaInicio)}`,OT_COL)
      ]}),
      new TableRow({height:{value:435},children:[
        otCell('Término:',OT_COL), otCell(`${v(d.fechaTermino)}  ${v(d.horaTermino)}`,OT_COL)
      ]})
    ]
  });

  // ── Logos (ICETEL + WOM) ──────────────────────────────────
  let icetelLogo = null, womLogo = null;
  try { const p=path.join(ROOT,'icetel-logo.jpeg'); if(fs.existsSync(p)) icetelLogo=fs.readFileSync(p); } catch(e){}
  try { const p=path.join(ROOT,'wom-logo.png');     if(fs.existsSync(p)) womLogo   =fs.readFileSync(p); } catch(e){}

  const logoParas = [];
  if (icetelLogo) logoParas.push(
    para(new ImageRun({data:icetelLogo, transformation:{width:314,height:175}}), 'left', 0)
  );
  if (womLogo) logoParas.push(
    new Paragraph({
      spacing:{before:40,after:0},
      indent:{left:420},
      children:[new ImageRun({data:womLogo, transformation:{width:220,height:102}})]
    })
  );
  if (!logoParas.length) logoParas.push(para(run('ICETEL / WOM',{bold:true,sz:20}),'left',0));

  // Celda logos (col izq header, sin bordes)
  const logoCell = new TableCell({
    width:{size:HDR_L,type:WidthType.DXA}, borders:noBrd,
    verticalAlign:VerticalAlign.TOP, margins:{top:40,bottom:40,left:0,right:40},
    children:logoParas
  });

  // Celda derecha header: contiene la mini-tabla OT
  const otCell_ = new TableCell({
    width:{size:HDR_R,type:WidthType.DXA}, borders:noBrd,
    verticalAlign:VerticalAlign.TOP, margins:{top:0,bottom:0,left:0,right:0},
    children:[otTable]
  });

  // Tabla exterior header (invisible)
  const hdrTable = new Table({
    width:{size:HDR_L+HDR_R,type:WidthType.DXA},
    columnWidths:[HDR_L,HDR_R],
    borders:noTblBrd,
    rows:[new TableRow({children:[logoCell, otCell_]})]
  });

  // ── Helpers para tablas de cuerpo ────────────────────────
  const bluCell = (text, w, span=1) => new TableCell({
    width:{size:w,type:WidthType.DXA}, ...(span>1?{columnSpan:span}:{}),
    borders:brd, shading:{fill:BLU,type:ShadingType.CLEAR},
    verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:100,right:80},
    children:[para(run(text,{bold:true,sz:18,c:WHT}))]
  });
  const valCell = (text, w, opts={}) => new TableCell({
    width:{size:w,type:WidthType.DXA}, borders:brd,
    verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:100,right:60},
    children:[para(run(text,{sz:18,bold:opts.bold||false,c:opts.c||BLK}))]
  });
  const whtCell = (text, w) => new TableCell({
    width:{size:w,type:WidthType.DXA}, borders:brd,
    shading:{fill:WHT,type:ShadingType.CLEAR},
    verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:100,right:60},
    children:[para(run(text,{bold:true}))]
  });
  const multiCell = (paragraphs, w) => new TableCell({
    width:{size:w,type:WidthType.DXA}, borders:brd,
    margins:{top:60,bottom:60,left:100,right:80}, children:paragraphs
  });

  // ── TABLE 2: Cliente/Sistemas/Tipo actividad/Sitio/Dirección ─
  const bodyTable = new Table({
    width:{size:FULL_W,type:WidthType.DXA}, columnWidths:[LBL_W,VAL_W], borders:tblBrd,
    rows:[
      new TableRow({height:{value:404},children:[bluCell('Cliente',LBL_W),        valCell('WOM',VAL_W,{bold:true})]}),
      new TableRow({height:{value:404},children:[bluCell('Sistemas',LBL_W),        valCell(v(d.infraestructura),VAL_W)]}),
      new TableRow({height:{value:404},children:[bluCell('Tipo de actividad',LBL_W),valCell(v(d.tipoActividad),VAL_W)]}),
      new TableRow({height:{value:404},children:[bluCell('Instalación',LBL_W),     valCell(v(d.instalacion),VAL_W)]}),
      new TableRow({height:{value:404},children:[bluCell('Dirección',LBL_W),       valCell(v(d.direccion),VAL_W)]})
    ]
  });

  // ── TABLE 3: Trabajos Realizados ──────────────────────────
  const trabajosParas = (v(d.trabajos)||'').split('\n').filter(l=>l.trim())
    .map(line => new Paragraph({spacing:{before:0,after:60},children:[run(line.trim())]}));
  if (!trabajosParas.length) trabajosParas.push(new Paragraph({spacing:{before:0,after:0},children:[run('')]}));
  const trabajosTable = new Table({
    width:{size:FULL_W,type:WidthType.DXA}, columnWidths:[FULL_W], borders:tblBrd,
    rows:[
      new TableRow({height:{value:404},children:[bluCell('Trabajos Realizados',FULL_W)]}),
      new TableRow({height:{value:Math.max(608,trabajosParas.length*300)},children:[multiCell(trabajosParas,FULL_W)]})
    ]
  });

  // ── TABLE 4: Observaciones ────────────────────────────────
  const obsTable = new Table({
    width:{size:FULL_W,type:WidthType.DXA}, columnWidths:[FULL_W], borders:tblBrd,
    rows:[
      new TableRow({height:{value:404},children:[bluCell('Observaciones',FULL_W)]}),
      new TableRow({height:{value:404},children:[multiCell(
        [para(run(v(d.observaciones)||'Sin observaciones adicionales'))], FULL_W
      )]})
    ]
  });

  // ── TABLE 5: Separador vacío ──────────────────────────────
  const emptyTable = new Table({
    width:{size:FULL_W,type:WidthType.DXA}, columnWidths:[FULL_W], borders:noTblBrd,
    rows:[new TableRow({height:{value:150},children:[
      new TableCell({width:{size:FULL_W,type:WidthType.DXA},borders:noBrd,children:[para(run(''))]})
    ]})]
  });

  // ── TABLE 6: Técnicos (5067 DXA) ─────────────────────────
  const tecNames = (d.tecnicos||[]).filter(Boolean);
  const tecTable = new Table({
    width:{size:TEC_W,type:WidthType.DXA}, columnWidths:[TEC_W], borders:tblBrd,
    rows:[
      new TableRow({height:{value:404},children:[bluCell('Técnico(s) Responsable(s)',TEC_W)]}),
      new TableRow({height:{value:404},children:[new TableCell({
        width:{size:TEC_W,type:WidthType.DXA}, borders:brd,
        verticalAlign:VerticalAlign.CENTER, margins:{top:40,bottom:40,left:100,right:60},
        children:[para([run('Nombre y Apellido:  ',{bold:true}), run(tecNames.join('    /    '))])]
      })]})
    ]
  });

  // ── TABLE 7: Datos Generales (1199|9165) ─────────────────
  const datTable = new Table({
    width:{size:FULL_W,type:WidthType.DXA}, columnWidths:[DAT_LBL,DAT_VAL], borders:tblBrd,
    rows:[
      new TableRow({height:{value:404},children:[
        new TableCell({width:{size:FULL_W,type:WidthType.DXA},columnSpan:2,borders:brd,
          shading:{fill:BLU,type:ShadingType.CLEAR},verticalAlign:VerticalAlign.CENTER,
          margins:{top:40,bottom:40,left:100,right:80},
          children:[para(run('Datos generales:',{bold:true,c:WHT}))]})
      ]}),
      new TableRow({height:{value:404},children:[whtCell('Sala:',DAT_LBL),   valCell(v(d.sala),DAT_VAL)]}),
      new TableRow({height:{value:404},children:[whtCell('Equipo:',DAT_LBL), valCell(v(d.equipo),DAT_VAL)]}),
      new TableRow({height:{value:404},children:[whtCell('Marca:',DAT_LBL),  valCell(v(d.marca),DAT_VAL)]}),
      new TableRow({height:{value:404},children:[whtCell('Modelo:',DAT_LBL), valCell(v(d.modelo),DAT_VAL)]})
    ]
  });

  // ── TABLE 8: Resumen + Fotos (5171|5245 = 10416) ─────────
  const photos   = d.photos   || [];
  const captions = d.captions || [];

  const mkPhotoCell = (b64, w) => {
    if (!b64) return new TableCell({width:{size:w,type:WidthType.DXA},borders:brd,
      verticalAlign:VerticalAlign.CENTER,margins:{top:40,bottom:40,left:40,right:40},
      children:[para(run(''))]});
    try {
      const buf = Buffer.from(b64.replace(/^data:image\/\w+;base64,/,''),'base64');
      return new TableCell({width:{size:w,type:WidthType.DXA},borders:brd,
        verticalAlign:VerticalAlign.CENTER,margins:{top:40,bottom:40,left:40,right:40},
        children:[para(new ImageRun({data:buf,transformation:{width:235,height:175}}),'center')]});
    } catch(e) {
      return new TableCell({width:{size:w,type:WidthType.DXA},borders:brd,
        children:[para(run('[error foto]',{sz:14}))]});
    }
  };
  const mkCapCell = (idx, w) => new TableCell({
    width:{size:w,type:WidthType.DXA},borders:brd,
    verticalAlign:VerticalAlign.CENTER,margins:{top:30,bottom:30,left:100,right:60},
    children:[para(run(captions[idx]||'',{sz:16,it:true}))]
  });

  const resRows = [
    new TableRow({height:{value:394},children:[
      new TableCell({width:{size:RES_W,type:WidthType.DXA},columnSpan:2,borders:brd,
        shading:{fill:BLU,type:ShadingType.CLEAR},verticalAlign:VerticalAlign.CENTER,
        margins:{top:40,bottom:40,left:100,right:80},
        children:[para(run('RESUMEN DE ACTIVIDAD:',{bold:true,c:WHT}))]})
    ]}),
    new TableRow({height:{value:414},children:[
      new TableCell({width:{size:RES_L,type:WidthType.DXA},borders:brd,
        margins:{top:40,bottom:40,left:100,right:60},children:[para(run(v(d.resumen1)))]}),
      new TableCell({width:{size:RES_R,type:WidthType.DXA},borders:brd,
        margins:{top:40,bottom:40,left:100,right:60},children:[para(run(v(d.resumen2)))]})
    ]})
  ];

  for (let i=0; i<Math.min(photos.length,8); i+=2) {
    const ph = i===0 ? 3231 : 3826;
    resRows.push(new TableRow({height:{value:ph},children:[
      mkPhotoCell(photos[i]||null,RES_L), mkPhotoCell(photos[i+1]||null,RES_R)
    ]}));
    resRows.push(new TableRow({height:{value:458},children:[
      mkCapCell(i,RES_L), mkCapCell(i+1,RES_R)
    ]}));
  }

  const resTable = new Table({
    width:{size:RES_W,type:WidthType.DXA}, columnWidths:[RES_L,RES_R], borders:tblBrd, rows:resRows
  });

  // ── Documento final ───────────────────────────────────────
  const gap = new Paragraph({spacing:{before:0,after:60},children:[]});
  const doc = new Document({
    sections:[{
      properties:{
        page:{
          margin:{top:720,right:708,bottom:280,left:566},
          size:{width:12240,height:15840}
        }
      },
      children:[
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

module.exports = buildDocxWom;
