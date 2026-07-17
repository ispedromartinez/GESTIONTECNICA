'use strict';
const fs   = require('fs');
const path = require('path');

function buildHtmlPreventivo(d) {
  const v   = s => (s||'').toString().trim();
  const esc = s => v(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Logo base64
  let logoSrc = '';
  try {
    let lp = path.join(__dirname,'..','logo.png'), ext='png';
    if (!fs.existsSync(lp)) { lp = path.join(__dirname,'..','logo.jpeg'); ext='jpeg'; }
    logoSrc = `data:image/${ext};base64,${fs.readFileSync(lp).toString('base64')}`;
  } catch(e) {}

  // Tigo logo base64
  let tigoSrc = '';
  try {
    const tp = path.join(__dirname,'..','tigo-logo.png');
    if (fs.existsSync(tp)) tigoSrc = `data:image/png;base64,${fs.readFileSync(tp).toString('base64')}`;
  } catch(e) {}

  // ── Datos generales rows ────────────────────────────────────
  const dg = (lbl, val, colspan=3) =>
    `<tr><td class="dg-lbl">${esc(lbl)}</td><td colspan="${colspan}" class="dg-val">${esc(val)}</td></tr>`;

  // ── Equipment table ─────────────────────────────────────────
  const equipos = d.equipos || [];
  const MOTORES = ['COMPRESOR 1','COMPRESOR 2','CONDENSADOR','V. INYECCION'];

  let eqRows = '';
  for (const eq of equipos) {
    const filas = eq.filas || MOTORES.map(m => ({motor: m}));
    const nf = filas.length;
    filas.forEach((f, fi) => {
      eqRows += `<tr>`;
      if (fi === 0) {
        eqRows += `<td class="eq-num" rowspan="${nf}">${esc(String(eq.numero||''))}</td>`;
        eqRows += `<td class="eq-datos" rowspan="${nf}"><table style="width:100%;border-collapse:collapse;"><tr><td class="dato-lbl" style="border-bottom:1px solid #c0c8d0">MARCA:</td><td class="dato-val" style="border-bottom:1px solid #c0c8d0">${esc(eq.marca||'')}</td></tr><tr><td class="dato-lbl" style="border-bottom:1px solid #c0c8d0">MODELO:</td><td class="dato-val" style="border-bottom:1px solid #c0c8d0">${esc(eq.modelo||'')}</td></tr><tr><td class="dato-lbl">N°SERIE:</td><td class="dato-val">${esc(eq.serie||'')}</td></tr></table></td>`;
        eqRows += `<td class="eq-cap" rowspan="${nf}">${esc(eq.capBtu||'')}</td>`;
      }
      eqRows += `<td class="motor-lbl">${esc(v(f.motor))}</td>`;
      eqRows += `<td>${esc(v(f.voltajeTipo))}</td>`;
      eqRows += `<td>${esc(v(f.vR))}</td><td>${esc(v(f.vS))}</td><td>${esc(v(f.vT))}</td>`;
      eqRows += `<td>${esc(v(f.iR))}</td><td>${esc(v(f.iS))}</td><td>${esc(v(f.iT))}</td>`;
      eqRows += `<td>${esc(v(f.verificacion))}</td>`;
      eqRows += `<td>${esc(v(f.limpSerpentines))}</td>`;
      eqRows += `<td>${esc(v(f.reapreteConex))}</td>`;
      eqRows += `<td>${esc(v(f.limpFiltro))}</td>`;
      eqRows += `<td>${esc(v(f.limpBandeja))}</td>`;
      eqRows += `<td>${esc(v(f.limpEvaporador))}</td>`;
      eqRows += `<td>${esc(v(f.aseoGeneral))}</td>`;
      eqRows += `<td class="obs-cell">${esc(v(f.observaciones))}</td>`;
      eqRows += `</tr>`;
    });
  }

  // ── Resumen table — solo equipos presentes ──────────────────
  const resLst = d.resumenLecturas || [];
  const eqNums = equipos.map((_, i) => i + 1);
  const getR = (n, f) => { const r = resLst.find(r => String(r.numero)===String(n)); return r ? v(r[f]) : ''; };
  const resHdr = eqNums.map(n => `<th>Eq. ${n}</th>`).join('');
  const resRow = (lbl, field) =>
    `<tr><td class="res-lbl">${esc(lbl)}</td>${eqNums.map(n=>`<td>${esc(getR(n,field))}</td>`).join('')}</tr>`;

  // ── Photos ───────────────────────────────────────────────────
  let fotosHtml = '';
  for (const grupo of (d.fotosGrupos || [])) {
    if (!grupo.fotos || !grupo.fotos.some(Boolean)) continue;
    fotosHtml += `<div class="foto-grupo"><div class="foto-titulo">${esc(grupo.titulo||'')}</div><div class="foto-grid">`;
    for (let i = 0; i < grupo.fotos.length; i++) {
      if (grupo.fotos[i]) {
        fotosHtml += `<div class="foto-cell"><img src="${grupo.fotos[i]}" class="foto-img"></div>`;
      }
    }
    fotosHtml += `</div></div>`;
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
@page { size: A4 portrait; margin: 8mm; }
*{ box-sizing: border-box; margin: 0; padding: 0; }
body{ font-family: Calibri, Arial, sans-serif; font-size: 7pt; color: #000; }

/* HEADER */
.header-table{ width: 100%; border-collapse: collapse; border: 2px solid #1a3a6c; margin-bottom: 4px; }
.header-logo{ width: 90px; text-align: center; padding: 4px; border-right: 1px solid #1a3a6c; }
.header-logo img{ max-width: 80px; max-height: 44px; }
.header-title{ background: #1a3a6c; color: #fff; text-align: center; padding: 4px 8px; }
.header-title h1{ font-size: 11pt; font-weight: 700; letter-spacing: .03em; }
.header-title h2{ font-size: 8pt; font-weight: 400; margin-top: 2px; }
.header-num{ font-size: 10pt; color: #ffd700; font-weight: 700; }
.header-right{ width: 80px; border-left: 1px solid #1a3a6c; text-align: center; padding: 4px; font-size: 7pt; }

/* DATOS GENERALES */
.dg-table{ width: 100%; border-collapse: collapse; margin-bottom: 4px; }
.dg-table td{ border: 1px solid #999; padding: 2px 4px; }
.dg-lbl{ background: #c5d9f1; font-weight: 700; width: 22%; white-space: nowrap; }
.dg-val{ background: #fff; }
.dg-head{ background: #1a3a6c; color: #fff; font-weight: 700; font-size: 8.5pt; }
.dg-badge{ background: #daeef3; font-weight: 700; }

/* SECTION TITLE */
.sec-title{ background: #1a3a6c; color: #fff; font-weight: 700; font-size: 8pt; padding: 2px 6px; margin: 4px 0 2px; }

/* EQUIPMENT TABLE */
.eq-table{ width: 100%; border-collapse: collapse; margin-bottom: 4px; table-layout: fixed; }
.eq-table th, .eq-table td{ border: 1px solid #999; padding: 1px 1px; text-align: center; vertical-align: middle; }
.eq-table th{ background: #daeef3; font-weight: 700; font-size: 5.5pt; }
.th-rot{ writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; font-size: 5pt; height: 44px; }
.eq-num{ background: #daeef3; font-weight: 700; width: 3%; }
.eq-datos{ text-align: left; padding: 1px 2px; width: 12%; font-size: 5pt; vertical-align: middle; }
.dato-lbl{ font-weight:700; white-space:nowrap; padding:1px 2px; font-size:3.8pt; }
.dato-val{ padding:1px 2px; font-size:3.8pt; }
.eq-cap{ width: 5%; font-size: 5pt; }
.motor-lbl{ background: #eef2ff; font-weight: 700; text-align: left; padding: 1px 2px; font-size: 5pt; white-space: nowrap; width: 11%; }
.obs-cell{ text-align: left; padding: 1px 4px; font-size: 5.5pt; width: 21%; }
.eq-table td{ font-size: 6pt; }

/* RESUMEN */
.res-table{ width: 100%; border-collapse: collapse; margin-bottom: 4px; }
.res-table th, .res-table td{ border: 1px solid #999; padding: 2px 3px; text-align: center; font-size: 6.5pt; }
.res-table th{ background: #1a3a6c; color: #fff; font-weight: 700; font-size: 6pt; }
.res-lbl{ background: #daeef3; font-weight: 700; text-align: left; padding: 2px 4px; white-space: nowrap; }

/* OBS */
.obs-box{ border: 1px solid #999; min-height: 28px; padding: 4px 6px; font-size: 7.5pt; margin-bottom: 4px; }

/* FOTOS */
.foto-grupo{ margin-bottom: 8px; page-break-inside: avoid; }
.foto-titulo{ font-weight: 700; font-size: 8pt; margin-bottom: 4px; padding: 2px 4px; background: #f1f5f9; border-left: 3px solid #1a3a6c; }
.foto-grid{ display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.foto-cell{ border: 1px solid #ddd; padding: 3px; }
.foto-img{ width: 100%; height: 180px; object-fit: contain; display: block; }
</style>
</head>
<body>

<!-- HEADER -->
<table class="header-table">
  <tr>
    <td class="header-logo" rowspan="2">${logoSrc ? `<img src="${logoSrc}">` : ''}</td>
    <td class="header-title">
      <h1>MANTENIMIENTO CLIMA PREVENTIVO EQUIPOS</h1>
      <h2>VENTANA &ndash; SPLIT &ndash; MOCHILA &ndash; PRECISIÓN &ndash; CORE CLIMA${d.trackerId ? `&nbsp;&nbsp;|&nbsp;&nbsp;<span class="header-num">N° INFORME: ${esc(d.trackerId)}</span>` : ''}</h2>
    </td>
    <td class="header-right" rowspan="2" style="text-align:center;padding:3px">
      ${tigoSrc ? `<img src="${tigoSrc}" style="max-width:68px;max-height:32px;object-fit:contain;display:block;margin:0 auto 3px">` : ''}
      ${d.qrDataUrl ? `<img src="${d.qrDataUrl}" style="width:48px;height:48px;display:block;margin:0 auto">` : ''}
      ${d.tareaOfficetrack ? `<div style="font-size:4.5pt;color:#666;margin-top:1px;font-family:monospace">${esc(v(d.tareaOfficetrack))}</div>` : ''}
    </td>
  </tr>
</table>

<!-- DATOS GENERALES -->
<table class="dg-table">
  <tr>
    <td class="dg-head" colspan="2">DATOS GENERALES DEL MANTENIMIENTO</td>
    <td class="dg-badge" style="width:18%">CRITICIDAD: ${esc(v(d.criticidad))}</td>
    <td class="dg-badge" style="width:20%">CATEGORÍA: ${esc(v(d.categoria))}</td>
    <td class="dg-badge" style="width:14%">SALA: ${esc(v(d.sala))}</td>
  </tr>
  <tr><td class="dg-lbl">NOMBRE SITIO</td><td colspan="4" class="dg-val">${esc(v(d.nombreNodo))}</td></tr>
  <tr><td class="dg-lbl">DIRECCIÓN</td><td colspan="4" class="dg-val">${esc(v(d.direccion))}</td></tr>
  <tr><td class="dg-lbl">COMUNA</td><td colspan="4" class="dg-val">${esc(v(d.comuna || d.ciudad))}</td></tr>
  <tr><td class="dg-lbl">EMPRESA INTEGRADORA</td><td colspan="4" class="dg-val">${esc(v(d.empresa))}</td></tr>
  <tr><td class="dg-lbl">NOMBRE EJECUTANTE</td><td colspan="4" class="dg-val">${esc(v(d.ejecutante))}</td></tr>
  <tr>
    <td class="dg-lbl">N° CRQ/INC</td><td class="dg-val">${esc(v(d.crq))}</td>
    <td class="dg-lbl">ID DE ACCESO</td><td colspan="2" class="dg-val">${esc(v(d.idAcceso))}</td>
  </tr>
  <tr>
    <td class="dg-lbl">FECHA DE EJECUCIÓN</td><td class="dg-val">${esc(v(d.fecha))} ${esc(v(d.hora))}</td>
    <td class="dg-lbl">ID DE SEGURIDAD</td><td colspan="2" class="dg-val" style="font-family:monospace;font-size:7pt;letter-spacing:.03em">${esc(v(d.tareaOfficetrack))}</td>
  </tr>
</table>

<!-- LECTURAS ELECTRICAS -->
<div class="sec-title">LECTURAS ELÉCTRICAS</div>
<table class="eq-table">
  <thead>
    <tr>
      <th rowspan="2" style="width:3%">N°</th>
      <th rowspan="2" style="width:12%">DATOS</th>
      <th rowspan="2" style="width:5%">CAP.<br>BTU/HRS</th>
      <th rowspan="2" style="width:11%">MOTOR</th>
      <th colspan="7">LECTURAS ELÉCTRICAS</th>
      <th rowspan="2" style="width:4%">VERIF.<br>ESTADO</th>
      <th rowspan="2" style="width:2.5%"><div class="th-rot">LIMP. SERPENTINES</div></th>
      <th rowspan="2" style="width:2.5%"><div class="th-rot">REAPRETE CONEXIONES</div></th>
      <th rowspan="2" style="width:2.5%"><div class="th-rot">LIMP. CAMBIO FILTRO</div></th>
      <th rowspan="2" style="width:2.5%"><div class="th-rot">LIMP. BANDEJA</div></th>
      <th rowspan="2" style="width:2.5%"><div class="th-rot">LIMP. EVAPORADOR</div></th>
      <th rowspan="2" style="width:2.5%"><div class="th-rot">ASEO GENERAL</div></th>
      <th rowspan="2" style="width:21%">OBSERVACIONES</th>
    </tr>
    <tr>
      <th style="width:5%">V<br>TIPO</th>
      <th style="width:4%">V(R)</th>
      <th style="width:4%">V(S)</th>
      <th style="width:4%">V(T)</th>
      <th style="width:4%">I(R)</th>
      <th style="width:4%">I(S)</th>
      <th style="width:4%">I(T)</th>
    </tr>
  </thead>
  <tbody>
    ${eqRows}
  </tbody>
</table>

<!-- RESUMEN -->
<div class="sec-title">RESUMEN LECTURAS ELÉCTRICAS</div>
<table class="res-table">
  <thead>
    <tr><th style="text-align:left;width:140px">Parámetro</th>${resHdr}</tr>
  </thead>
  <tbody>
    ${resRow('FLUJO DE AIRE','flujoAire')}
    ${resRow('TEMP. INYECCIÓN (°C)','tempIny')}
    ${resRow('TEMP. RETORNO (°C)','tempRet')}
    ${resRow('SETPOINT (°C)','setpoint')}
    ${resRow('TIPO REFRIGERANTE','refrigerante')}
  </tbody>
</table>

<!-- OBSERVACIONES -->
<div class="sec-title">OBSERVACIONES</div>
<div class="obs-box">${esc(v(d.observacionesGenerales))}</div>

<!-- FOTOS -->
${fotosHtml}

</body>
</html>`;
}

module.exports = { buildHtmlPreventivo };
