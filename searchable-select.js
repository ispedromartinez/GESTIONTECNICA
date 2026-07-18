/* ============================================================================
 * searchable-select.js — Desplegable con buscador (estilo TIGO) unificado.
 *
 * Mejora automáticamente TODO <select> nativo de la página (y los que se
 * agreguen dinámicamente) convirtiéndolo en un dropdown con búsqueda, sin
 * cambiar la lógica de la app: el <select> original queda oculto como fuente
 * de verdad y se sigue actualizando su .value / disparando 'change'.
 *
 * Cómo evitar que un select se mejore: añade el atributo  data-no-enhance
 * Los <select multiple> nunca se mejoran.
 * ==========================================================================*/
(function () {
  'use strict';

  const NORM = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const ESC = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function hl(t, q) {
    if (!q) return ESC(t);
    const nq = NORM(q), nt = NORM(t); let r = '', i = 0;
    while (i < t.length) {
      if (nt.slice(i, i + nq.length) === nq) { r += '<mark>' + ESC(t.slice(i, i + nq.length)) + '</mark>'; i += nq.length; }
      else { r += ESC(t[i]); i++; }
    }
    return r;
  }

  // Permite sincronizar la vista cuando la app cambia select.value por código.
  const VALUE_DESC = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const INDEX_DESC = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');

  function enhance(sel) {
    if (!sel || sel.multiple || sel.dataset.ssDone || sel.hasAttribute('data-no-enhance')) return;
    sel.dataset.ssDone = '1';

    const wrap = document.createElement('div');
    wrap.className = 'ss-wrap';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);

    // Copiar la métrica real del <select> original para NO agrandar la lista:
    // así en cada página el control mantiene el mismo tamaño/compacidad que antes.
    const cs = getComputedStyle(sel);
    // getComputedStyle().height = alto de CONTENIDO (sin padding/borde). Por eso
    // usamos box-sizing:content-box y sumamos padding+borde → caja idéntica al nativo.
    const box = {
      boxSizing: 'content-box',
      fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily, lineHeight: cs.lineHeight,
      color: cs.color, height: cs.height,
      paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight,
      borderTopLeftRadius: cs.borderTopLeftRadius, borderTopRightRadius: cs.borderTopRightRadius,
      borderBottomLeftRadius: cs.borderBottomLeftRadius, borderBottomRightRadius: cs.borderBottomRightRadius,
      borderWidth: cs.borderTopWidth, borderStyle: cs.borderTopStyle === 'none' ? 'solid' : cs.borderTopStyle, borderColor: cs.borderTopColor
    };
    const csBg = cs.backgroundColor;
    // Los <select> nativos no se encogen al cambiar de opción: conservan el ancho
    // de su opción más larga. Replicamos ese comportamiento sin perder fluidez:
    //  - si ocupaba ~todo el contenedor → se queda fluido (width:100%)
    //  - si era de ancho por contenido → fijamos ese ancho como mínimo
    const selWidth = cs.width;
    const selW = parseFloat(selWidth) || 0;
    const parentW = wrap.parentElement ? wrap.parentElement.clientWidth : 0;
    wrap.style.boxSizing = 'border-box';
    if (parentW && selW >= parentW - 6) { wrap.style.width = '100%'; }
    else { wrap.style.width = 'auto'; wrap.style.minWidth = selWidth; }

    sel.classList.add('ss-native');
    sel.tabIndex = -1;

    const disp = document.createElement('button');
    disp.type = 'button';
    disp.className = 'ss-disp';
    disp.innerHTML = '<span class="ss-val"></span><span class="ss-arr">▾</span>';
    Object.assign(disp.style, box);
    if (csBg && csBg !== 'rgba(0, 0, 0, 0)' && csBg !== 'transparent') disp.style.background = csBg;
    wrap.appendChild(disp);

    const panel = document.createElement('div');
    panel.className = 'ss-panel';
    panel.style.fontSize = cs.fontSize;
    panel.innerHTML = '<div class="ss-search"><input type="text" class="ss-in" placeholder="Buscar..." autocomplete="off" spellcheck="false"></div><div class="ss-list"></div>';
    wrap.appendChild(panel);

    const input = panel.querySelector('.ss-in');
    const list = panel.querySelector('.ss-list');
    const valEl = disp.querySelector('.ss-val');
    let hi = -1;

    function syncDisp() {
      const o = sel.options[sel.selectedIndex];
      const txt = o ? o.text : '';
      valEl.textContent = txt || (sel.dataset.placeholder || '');
      valEl.classList.toggle('ss-placeholder', !o || o.value === '' || !txt);
      disp.disabled = sel.disabled;
    }
    function buildList(q) {
      const nq = NORM(q);
      const opts = [...sel.options].map((o, i) => ({ o, i })).filter(({ o }) => !nq || NORM(o.text).includes(nq) || NORM(o.value).includes(nq));
      hi = -1;
      list.innerHTML = opts.length
        ? opts.map(({ o, i }, k) => `<div class="ss-opt${i === sel.selectedIndex ? ' sel' : ''}" data-i="${i}" data-k="${k}">${hl(o.text || ' ', q)}</div>`).join('')
        : '<div class="ss-empty">Sin resultados</div>';
      list.querySelectorAll('.ss-opt').forEach(el => {
        el.addEventListener('mousedown', e => { e.preventDefault(); pick(+el.dataset.i); });
        el.addEventListener('mouseenter', () => { hi = +el.dataset.k; paintHi(); });
      });
    }
    function paintHi() {
      const els = list.querySelectorAll('.ss-opt');
      els.forEach((el, k) => el.classList.toggle('hi', k === hi));
      if (hi >= 0) els[hi] && els[hi].scrollIntoView({ block: 'nearest' });
    }
    // El panel es position:fixed (coordenadas puestas a mano aquí) en vez de
    // absolute-al-wrap: así no lo recorta ningún ancestro con overflow:hidden
    // (tarjetas ".section", modales con scroll, etc.) ni queda atrapado detrás
    // de otro contenido con su propio stacking context.
    // Un ancestro position:fixed es la firma de todo modal de esta app
    // (.modal-overlay, .modal-bg, .ip-modal-bg, .fmt-modal-bg, etc. — nombres
    // distintos por página, pero todos son overlays fixed;inset:0). Solo ahí
    // tiene sentido acotar al próximo elemento visible: fuera de un modal el
    // desplegable vive en el flujo normal de la página (con su propio
    // scroll), así que no hay razón real para no abrir hacia abajo.
    function dentroDeModal() {
      let el = wrap.parentElement;
      for (let hops = 0; el && el !== document.body && hops < 8; hops++, el = el.parentElement) {
        if (getComputedStyle(el).position === 'fixed') return true;
      }
      return false;
    }
    // Próximo elemento visible que quede realmente DEBAJO (no al lado, como un
    // botón en la misma fila) en el flujo del documento: p.ej. los botones de
    // un modal justo después del campo. Ese es el límite real que le importa
    // al usuario, más preciso que "hasta el borde de la ventana" — pero solo
    // dentro de un modal (ver dentroDeModal). En la página normal se usa el
    // alto completo de la ventana: es normal que el panel se superponga
    // temporalmente al contenido de abajo mientras está abierto.
    function nextVisibleBelow() {
      if (!dentroDeModal()) return window.innerHeight;
      let el = wrap;
      // Tope de 3 niveles: alcanza para llegar a los botones de un modal
      // (wrap → field → field-row → acciones) sin llegar tan arriba que
      // termine "chocando" con la próxima tarjeta/sección de la página,
      // que no es un solape real (hay de sobra para abrir hacia abajo).
      for (let hops = 0; el && el !== document.body && hops < 3; hops++) {
        let sib = el.nextElementSibling;
        while (sib) {
          const rc = sib.getBoundingClientRect();
          if ((rc.width || rc.height) && rc.top >= el.getBoundingClientRect().bottom - 4) return rc.top;
          sib = sib.nextElementSibling;
        }
        el = el.parentElement;
      }
      return window.innerHeight;
    }
    function positionPanel() {
      const r = disp.getBoundingClientRect();
      panel.style.left = r.left + 'px';
      panel.style.width = r.width + 'px';
      panel.classList.remove('drop-up');
      panel.style.bottom = 'auto';
      panel.style.top = (r.bottom + 4) + 'px';
      const panelH = panel.offsetHeight;
      const limit = Math.min(window.innerHeight, nextVisibleBelow());
      const spaceBelow = limit - r.bottom;
      const spaceAbove = r.top;
      // Si no cabe hacia abajo (p.ej. un select pegado a los botones de un
      // modal), se abre hacia arriba: evita que el panel tape controles
      // debajo y quede imposible de clickear sin cerrarlo antes.
      if (spaceBelow < panelH && spaceAbove > spaceBelow) {
        panel.classList.add('drop-up');
        panel.style.top = 'auto';
        panel.style.bottom = (window.innerHeight - r.top + 4) + 'px';
      }
    }
    function open() {
      if (sel.disabled) return;
      closeAll(panel);
      buildList('');
      panel.classList.add('open'); disp.classList.add('open');
      positionPanel();
      input.value = ''; setTimeout(() => input.focus(), 0);
    }
    function close() { panel.classList.remove('open'); disp.classList.remove('open'); hi = -1; }
    window.addEventListener('resize', () => { if (panel.classList.contains('open')) positionPanel(); });
    // Un scroll debajo (página, modal, tabla) invalida las coordenadas fijas: se cierra en vez de quedar mal
    // ubicado. Pero el scroll DENTRO de la propia lista (.ss-list, al recorrer muchas opciones) también dispara
    // 'scroll' en fase de captura — sin el filtro por e.target, cerraba el panel apenas el usuario intentaba
    // bajar la lista.
    window.addEventListener('scroll', e => { if (panel.classList.contains('open') && !panel.contains(e.target)) close(); }, true);
    function pick(idx) {
      if (idx === sel.selectedIndex) { close(); disp.focus(); return; }
      INDEX_DESC.set.call(sel, idx);
      syncDisp();
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      close(); disp.focus();
    }

    disp.addEventListener('click', () => panel.classList.contains('open') ? close() : open());
    disp.addEventListener('keydown', e => {
      if (['ArrowDown', 'Enter', ' '].includes(e.key) && !panel.classList.contains('open')) { e.preventDefault(); open(); }
    });
    input.addEventListener('input', () => buildList(input.value.trim()));
    input.addEventListener('keydown', e => {
      const els = list.querySelectorAll('.ss-opt');
      if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(hi + 1, els.length - 1); paintHi(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(hi - 1, 0); paintHi(); }
      else if (e.key === 'Enter') { e.preventDefault(); const el = els[hi] || els[0]; if (el && el.dataset.i != null) pick(+el.dataset.i); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); disp.focus(); }
    });
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });

    // La app cambia opciones (innerHTML) o el valor por código → re-sincronizar vista.
    sel.addEventListener('change', syncDisp);
    new MutationObserver(syncDisp).observe(sel, { childList: true });
    try {
      Object.defineProperty(sel, 'value', {
        configurable: true,
        get() { return VALUE_DESC.get.call(this); },
        set(v) { VALUE_DESC.set.call(this, v); syncDisp(); }
      });
      Object.defineProperty(sel, 'selectedIndex', {
        configurable: true,
        get() { return INDEX_DESC.get.call(this); },
        set(v) { INDEX_DESC.set.call(this, v); syncDisp(); }
      });
    } catch (_) { /* algunos navegadores no permiten redefinir; el resto sigue ok */ }

    syncDisp();
  }

  function closeAll(except) {
    document.querySelectorAll('.ss-panel.open').forEach(p => { if (p !== except) { p.classList.remove('open'); const d = p.previousElementSibling; if (d) d.classList.remove('open'); } });
  }

  function enhanceAll(root) {
    (root || document).querySelectorAll('select:not([data-ss-done])').forEach(enhance);
  }

  if (document.readyState !== 'loading') enhanceAll();
  else document.addEventListener('DOMContentLoaded', () => enhanceAll());

  // Selects agregados dinámicamente (modales, listas que vengan, etc.)
  new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'SELECT') enhance(n);
        else if (n.querySelector) enhanceAll(n);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.enhanceSelects = enhanceAll;
})();
