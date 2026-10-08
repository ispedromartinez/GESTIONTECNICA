// ════════════════════════════════════════════════════════════════
// Lectura de un .docx de informe Clima generado por docx/clima.js.
// Sirve para (a) subir un informe ya confeccionado al historial,
// (b) recontar sus fotos y (c) reabrir en modo edición un informe que no
// tiene guardado el payload completo con el que se generó.
//
// Depende del layout fijo de buildDocx: los campos se ubican por el texto
// de su etiqueta ("Nombre de Sitio", "LPU", …) y, en las tablas sin
// etiqueta por celda (tickets, equipamiento, mediciones), por la distancia
// fija a la cabecera de la sección. buildDocx nunca deja celdas sin texto
// (los vacíos salen como "N/A"), así que esas distancias son estables.
// Si se cambia el layout de docx/clima.js, hay que actualizar esto.
// ════════════════════════════════════════════════════════════════
const JSZip = require('jszip');

const ENTIDADES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const decodificar = s => s.replace(/&(amp|lt|gt|quot|apos);/g, m => ENTIDADES[m]);

// Todos los <w:t>texto</w:t> de un XML de Word, en orden de aparición.
function textosWord(xml) {
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => decodificar(m[1]));
}

async function abrir(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('El archivo no tiene word/document.xml (¿es realmente un .docx de Word?).');
  return { zip, xml: await doc.async('string') };
}

// Campos del informe con los mismos nombres que el payload de POST /generar.
// Con portada (sitios NextStream) no cambia nada: se busca por etiqueta.
async function leerCamposClima(buffer) {
  const { zip, xml } = await abrir(buffer);
  const textos = textosWord(xml);
  const header = zip.file('word/header1.xml');
  const textosHeader = header ? textosWord(await header.async('string')) : [];

  const limpio = t => (t === undefined || t === 'N/A') ? '' : t;
  const tras = (arr, etiqueta, salto = 1) => {
    const i = arr.indexOf(etiqueta);
    return i >= 0 ? limpio(arr[i + salto]) : '';
  };

  const out = {
    codInforme:    tras(textosHeader, 'COD.'),
    nombreSitio:   tras(textos, 'Nombre de Sitio'),
    codigoSitio:   tras(textos, 'Código de Sitio'),
    direccion:     tras(textos, 'Dirección'),
    lpu:           tras(textos, 'LPU'),
    sala:          tras(textos, 'Sala'),
    fecha:         tras(textos, 'Fecha Ejecución'),
    tecnico:       tras(textos, 'Técnico Ejecutante'),
    supervisor:    tras(textos, 'Supervisor'),
    observaciones: tras(textos, 'OBSERVACIONES Y RECOMENDACIONES'),
    ticketInc: '', ticketTE: '', ticketTI: '', ticketRED: '', numOT: '',
    eqSala: '', eqNumero: '', circuito: '', eqTipo: '', eqMarca: '', eqModelo: '',
    resumen: '',
    m_cv: '', m_ca: '', m_ev: '', m_ea: '', m_condv: '', m_conda: '', m_tinj: '', m_tret: ''
  };

  // Tickets: 5 etiquetas (Inc./TE/TI/RED/Numero de OT) y luego los 5 valores.
  const iTk = textos.indexOf('Números de Tickets');
  if (iTk >= 0) {
    [out.ticketInc, out.ticketTE, out.ticketTI, out.ticketRED, out.numOT] =
      [6, 7, 8, 9, 10].map(k => limpio(textos[iTk + k]));
  }

  // Equipamiento: 5 cabeceras y luego Sala, N° Equipo, Tipo, Marca, Modelo.
  // El N° sale como "E4 C5" cuando hay circuito, o solo "4" si no.
  const iEq = textos.indexOf('DATOS GENERALES DEL EQUIPAMIENTO');
  if (iEq >= 0) {
    out.eqSala   = limpio(textos[iEq + 6]);
    const numero = limpio(textos[iEq + 7]);
    out.eqTipo   = limpio(textos[iEq + 8]);
    out.eqMarca  = limpio(textos[iEq + 9]);
    out.eqModelo = limpio(textos[iEq + 10]);
    const m = numero.match(/^E(\S*)\s+C(\S*)$/i);
    if (m) { out.eqNumero = m[1]; out.circuito = m[2]; }
    else out.eqNumero = numero;
  }

  // Resumen: cada oración es una viñeta; van entre las dos cabeceras.
  const iRs = textos.indexOf('RESUMEN DE LA ACTIVIDAD');
  if (iRs >= 0 && iEq > iRs) {
    out.resumen = textos.slice(iRs + 1, iEq).filter(t => t && t !== 'N/A').join(' ');
  }

  // Mediciones: 13 cabeceras + N° de equipo, luego los 8 valores.
  const iMed = textos.indexOf('MEDICIONES GENERALES');
  if (iMed >= 0) {
    ['m_cv', 'm_ca', 'm_ev', 'm_ea', 'm_condv', 'm_conda', 'm_tinj', 'm_tret']
      .forEach((k, j) => { out[k] = limpio(textos[iMed + 15 + j]); });
  }

  if (!out.codInforme && !out.nombreSitio) {
    throw new Error('No se pudo leer el informe: no tiene el formato de esta aplicación (¿es un .docx de otro origen?).');
  }
  return out;
}

// Ids de las imágenes de la tabla "REGISTRO FOTOGRAFICO" (no logos ni portada,
// que aparecen antes en el documento).
function idsFotos(xml) {
  const i = xml.indexOf('REGISTRO FOTOGRAFICO');
  if (i < 0) return [];
  return [...xml.slice(i).matchAll(/<a:blip r:embed="([^"]+)"/g)].map(m => m[1]);
}

async function contarFotosClima(buffer) {
  const { xml } = await abrir(buffer);
  return idsFotos(xml).length;
}

// Las fotos como data URIs, listas para volver a pasar a buildDocx. Sin esto,
// editar un informe sin payload guardado y regenerarlo borraría las fotos.
async function extraerFotosClima(buffer) {
  const { zip, xml } = await abrir(buffer);
  const ids = idsFotos(xml);
  if (!ids.length) return [];
  const rels = zip.file('word/_rels/document.xml.rels');
  if (!rels) return [];
  const destinos = {};
  for (const m of (await rels.async('string')).matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    destinos[m[1]] = m[2];
  }
  const fotos = [];
  for (const id of ids) {
    const destino = destinos[id];
    const media = destino && zip.file('word/' + destino.replace(/^\/?word\//, ''));
    if (!media) { fotos.push(null); continue; }
    const ext = destino.split('.').pop().toLowerCase();
    fotos.push(`data:${ext === 'png' ? 'image/png' : 'image/jpeg'};base64,${await media.async('base64')}`);
  }
  return fotos;
}

module.exports = { leerCamposClima, contarFotosClima, extraerFotosClima };
