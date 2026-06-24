// ── Validación de RUT chileno (módulo 11) ─────────────────────
// Regla de negocio 4: el RUT debe validarse con dígito verificador.

// Limpia un RUT: quita puntos, guión y espacios; K en mayúscula.
function limpiarRut(rut) {
  if (!rut || typeof rut !== 'string') return '';
  return rut.replace(/[.\-\s]/g, '').toUpperCase();
}

// Calcula el dígito verificador del cuerpo (string de solo dígitos).
function calcularDV(cuerpo) {
  let suma = 0;
  let multiplo = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i], 10) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

// Devuelve true si el RUT es válido (cuerpo numérico + DV correcto).
function validarRut(rut) {
  const limpio = limpiarRut(rut);
  if (!/^\d{7,8}[0-9K]$/.test(limpio)) return false;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  return calcularDV(cuerpo) === dv;
}

// Normaliza a formato canónico "12345678-9" para guardar/comparar.
function normalizarRut(rut) {
  const limpio = limpiarRut(rut);
  if (limpio.length < 2) return limpio;
  return `${limpio.slice(0, -1)}-${limpio.slice(-1)}`;
}

module.exports = { validarRut, normalizarRut, limpiarRut, calcularDV };
