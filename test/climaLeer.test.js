// Ida y vuelta: buildDocx (docx/clima.js) → leerCamposClima (docx/climaLeer.js).
// Si alguien cambia el layout del Word sin actualizar el lector, esto falla.
const { test } = require('node:test');
const assert = require('node:assert');
const buildDocx = require('../docx/clima');
const { leerCamposClima, contarFotosClima, extraerFotosClima } = require('../docx/climaLeer');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const BASE = {
  codInforme: 'YG0806ANTONITX01', nombreSitio: 'Sitio & Uno', codigoSitio: 'CC-001',
  direccion: 'Calle <1>', fecha: '02-10-2026', sala: 'TX', tecnico: 'Tec A',
  supervisor: 'Sup B', numOT: 'OT7', lpu: 'LPU3', ticketInc: 'INC1', ticketTE: 'TE2',
  ticketTI: 'TI3', ticketRED: 'RED4', resumen: 'Hice A. Hice B.', observaciones: 'Obs "X"',
  eqSala: 'S2', eqNumero: '4', circuito: '5', eqTipo: 'Split', eqMarca: 'LG', eqModelo: 'M1',
  m_cv: '1', m_ca: '2', m_ev: '3', m_ea: '4', m_condv: '5', m_conda: '6', m_tinj: '7', m_tret: '8'
};

test('climaLeer: recupera todos los campos (con caracteres especiales)', async () => {
  const leido = await leerCamposClima(await buildDocx(BASE));
  for (const [k, v] of Object.entries(BASE)) assert.equal(leido[k], v, `campo ${k}`);
});

test('climaLeer: sin circuito el N° de equipo sale tal cual', async () => {
  const leido = await leerCamposClima(await buildDocx({ ...BASE, circuito: '' }));
  assert.equal(leido.eqNumero, '4');
  assert.equal(leido.circuito, '');
});

test('climaLeer: campos vacíos vuelven vacíos, no "N/A"', async () => {
  const leido = await leerCamposClima(await buildDocx({ codInforme: 'X1', nombreSitio: 'S' }));
  assert.equal(leido.lpu, '');
  assert.equal(leido.m_tret, '');
  assert.equal(leido.resumen, '');
});

test('climaLeer: informe con portada NextStream se lee igual', async () => {
  const d = { ...BASE, nombreSitio: 'DATA CENTER APOQUINDO', tituloPortada: 'FUGA' };
  const leido = await leerCamposClima(await buildDocx(d));
  assert.equal(leido.nombreSitio, 'DATA CENTER APOQUINDO');
  assert.equal(leido.codInforme, BASE.codInforme);
});

test('climaLeer: cuenta y extrae solo las fotos del registro fotográfico', async () => {
  const buf = await buildDocx({ ...BASE, nombreSitio: 'DATA CENTER SAN MARTIN', photos: [PNG, null, PNG] });
  assert.equal(await contarFotosClima(buf), 2);
  const fotos = await extraerFotosClima(buf);
  assert.equal(fotos.length, 2);
  assert.ok(fotos.every(f => f.startsWith('data:image/png;base64,')));
});

test('climaLeer: un .docx ajeno se rechaza', async () => {
  const JSZip = require('jszip');
  const z = new JSZip();
  z.file('word/document.xml', '<w:document><w:t>Hola</w:t></w:document>');
  const ajeno = await z.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(leerCamposClima(ajeno), /formato de esta aplicación/);
});
