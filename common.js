// Helpers compartidos por TODAS las páginas. Cargar (sin defer) antes del
// <script> de cada página. Fuente única de esc/escArg — antes cada página
// tenía su propia copia y el drift causó un XSS (WOM no las tenía).
//
// REGLA: todo dato del servidor va por esc() antes de innerHTML, y por
// escArg() dentro de onclick="...". Ver CLAUDE.md.
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escArg(s){
  return esc(String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"));
}

// ── Interceptor global de fetch (auth) ─────────────────────────
// Única fuente del header Authorization. Antes cada página resolvía esto por
// su cuenta: TIGO/WOM tenían un authH() local que había que acordarse de
// pasar a mano en cada fetch (fácil de olvidar en un fetch nuevo); Preventivo
// en cambio ya parcheaba window.fetch acá mismo, a nivel de página. Se
// unifica en el mecanismo de Preventivo (a prueba de olvidos) y se mueve a
// común.js para que ninguna página tenga su propia copia — mismo motivo que
// esc/escArg.
(function(){
  const _origFetch = window.fetch;
  window.fetch = (url, opts={}) => {
    // El token puede estar en localStorage ("recordarme") o en sessionStorage.
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    if (token) { opts.headers = { ...(opts.headers||{}), 'Authorization': 'Bearer '+token }; }
    return _origFetch(url, opts);
  };
})();

// ── Compresión de fotos ────────────────────────────────────────
// Los informes (TIGO/WOM/Preventivo) embeben las fotos en el .docx/PDF a
// ~210-235px de ancho (docx/clima.js, docx/wom.js) — no tiene sentido cargar
// en memoria/estado la foto a resolución completa de cámara (varios MB)
// mientras se llena el formulario. Recibe el dataURL crudo de
// FileReader.readAsDataURL y lo re-encodea más chico si hace falta.
function comprimirImagenDataURL(dataUrl, maxDim, calidad) {
  maxDim = maxDim || 1600;
  calidad = calidad || 0.85;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h || (w <= maxDim && h <= maxDim)) return resolve(dataUrl);
      const scale = maxDim / Math.max(w, h);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try { resolve(canvas.toDataURL('image/jpeg', calidad)); }
      catch (e) { resolve(dataUrl); }
    };
    // Formato no decodificable por el navegador (p. ej. HEIC en algunos
    // Android/desktop) — se manda tal cual, igual que hacían ya
    // getPhotoForExport/getFotoForExport ante el mismo caso.
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ── Resiliencia offline (IndexedDB) ────────────────────────────
// La app no puede generar el .docx/PDF en el cliente — el único trabajo
// realista sin señal es no perder el formulario+fotos ya cargados:
// autoguardar el borrador en curso, y si el envío falla por falta de
// conexión, encolarlo para reintentarlo solo cuando vuelva la señal.
// Un registro de 'borradores' por página (keyPath 'pagina'); una cola de
// 'pendientes' (keyPath 'id') que puede acumular más de un envío fallido.
const OFFLINE_DB_NAME = 'informes_offline';
const OFFLINE_DB_VERSION = 1;
let _offlineDBPromise = null;

function offlineDB() {
  if (!_offlineDBPromise) {
    _offlineDBPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('borradores')) db.createObjectStore('borradores', { keyPath: 'pagina' });
        if (!db.objectStoreNames.contains('pendientes')) db.createObjectStore('pendientes', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return _offlineDBPromise;
}

async function guardarBorrador(pagina, datos) {
  try {
    const db = await offlineDB();
    await new Promise((res, rej) => {
      const tx = db.transaction('borradores', 'readwrite');
      tx.objectStore('borradores').put({ pagina, datos, guardadoEn: Date.now() });
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch (e) { /* autoguardado best-effort — nunca bloquea la UI */ }
}

async function cargarBorrador(pagina) {
  try {
    const db = await offlineDB();
    return await new Promise((res, rej) => {
      const req = db.transaction('borradores', 'readonly').objectStore('borradores').get(pagina);
      req.onsuccess = () => res(req.result ? req.result.datos : null);
      req.onerror = () => rej(req.error);
    });
  } catch (e) { return null; }
}

async function borrarBorrador(pagina) {
  try {
    const db = await offlineDB();
    db.transaction('borradores', 'readwrite').objectStore('borradores').delete(pagina);
  } catch (e) {}
}

async function encolarPendiente(pagina, url, payload) {
  const id = `${pagina}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    const db = await offlineDB();
    await new Promise((res, rej) => {
      const tx = db.transaction('pendientes', 'readwrite');
      tx.objectStore('pendientes').put({ id, pagina, url, payload, creadoEn: Date.now() });
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch (e) {}
  return id;
}

async function listarPendientes(pagina) {
  try {
    const db = await offlineDB();
    const req = await new Promise((res, rej) => {
      const r = db.transaction('pendientes', 'readonly').objectStore('pendientes').getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
    return pagina ? req.filter(p => p.pagina === pagina) : req;
  } catch (e) { return []; }
}

async function borrarPendiente(id) {
  try {
    const db = await offlineDB();
    db.transaction('pendientes', 'readwrite').objectStore('pendientes').delete(id);
  } catch (e) {}
}

async function marcarPendienteConError(id, mensaje) {
  try {
    const db = await offlineDB();
    const tx = db.transaction('pendientes', 'readwrite');
    const store = tx.objectStore('pendientes');
    const req = store.get(id);
    req.onsuccess = () => { if (req.result) store.put({ ...req.result, ultimoError: mensaje }); };
  } catch (e) {}
}

// Reintenta enviar los pendientes de una página. Nunca descarta trabajo del
// técnico salvo éxito confirmado (2xx): en falla de red se deja para el
// próximo intento; en 401/403 se deja para cuando haya un token vigente; en
// cualquier otro código se marca con el error y se saltea en las próximas
// pasadas automáticas (se reintenta recién en la siguiente carga de página).
// El Authorization lo agrega el interceptor global de fetch de más arriba —
// no hace falta construirlo acá.
async function reintentarPendientes(pagina, onExito) {
  const pendientes = await listarPendientes(pagina);
  for (const p of pendientes) {
    if (p.ultimoError) continue;
    let resp;
    try {
      resp = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p.payload)
      });
    } catch (e) {
      break; // sigue sin señal — se reintenta en el próximo tick/evento online
    }
    if (resp.ok) {
      await borrarPendiente(p.id);
      if (onExito) { try { await onExito(p, resp); } catch (e) {} }
    } else if (resp.status === 401 || resp.status === 403) {
      // token vencido — se deja en cola, el próximo intento toma el token vigente
    } else {
      const e = await resp.json().catch(() => ({}));
      await marcarPendienteConError(p.id, e.error || `HTTP ${resp.status}`);
    }
  }
}

function iniciarSincronizacionOffline(pagina, onExito) {
  const intentar = () => reintentarPendientes(pagina, onExito);
  intentar();
  window.addEventListener('online', intentar);
  setInterval(intentar, 20000);
}
