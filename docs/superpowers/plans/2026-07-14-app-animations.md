# App Animations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir animaciones suaves y consistentes de apertura/cierre (modales,
dropdowns, paneles), fade-in de página y micro-interacciones en toda la app,
respetando `prefers-reduced-motion`.

**Architecture:** Dos archivos compartidos nuevos en la raíz (`animations.css`,
`animations.js`) servidos por `express.static`. Cada página los incluye en
`<head>`. El CSS convierte el patrón `display:none/flex` de los contenedores
(modales/dropdowns/paneles) a `visibility/opacity/transform` para que la
`transition` anime abrir **y** cerrar sin tocar el JS existente.

**Tech Stack:** HTML/CSS/JS vanilla, Express static. Verificación con Playwright
(headless, vía `uvx --with playwright`) contra el server en `localhost:3000` y
repros aislados en scratchpad; no hay runner de tests para front.

## Global Constraints

- No dependencias nuevas (sin librerías de animación). Copiado verbatim del spec:
  "Fuera de alcance: Librerías de animación (GSAP, Framer, etc.)".
- `animations.css` debe cargarse **después** del `<style>` inline de cada página
  para ganar la cascada y sobrescribir el patrón `display`.
- `@media (prefers-reduced-motion: reduce)` desactiva animaciones/transiciones
  y garantiza estado final visible. Obligatorio.
- El fade-in de página nunca debe dejar contenido invisible si el JS no corre
  (regla de seguridad en CSS).
- Selectores reales por página (auditoría del spec):
  catalogo `.modal-bg.show`; admin `.modal-bg.open` + `.overlay.open`;
  dashboard `.overlay.show`; informe_clima_app `.modal-overlay.open`;
  informe_wom_app `.panel.active`; preventivo `.modal-overlay.open` +
  `.dropdown-menu.open`.

---

### Task 1: Crear `animations.css` con reglas base + reduced-motion

**Files:**
- Create: `animations.css`
- Verify: repro en scratchpad + Playwright

**Interfaces:**
- Produces: clases/patrones que las páginas activan al añadir el `<link>`. Estados
  animados vía selectores `[contenedor].[estado]` listados en Global Constraints.
  Utilidad `body:not(.no-anim)` para el fade-in (Task 2 añade `.loaded`).

- [ ] **Step 1: Escribir `animations.css`**

```css
/* animations.css — animaciones compartidas de la app.
   Cargar DESPUÉS del <style> inline de cada página. */

/* ── Modales / overlays / dropdowns ──
   Las páginas ocultan con display:none y muestran con display:flex/block. Eso
   impide animar el CIERRE (display:none corta la transición). Solución: estos
   contenedores son position:fixed/absolute (no afectan al layout), así que los
   forzamos a estar SIEMPRE "display" y los ocultamos con opacity/visibility/
   pointer-events. Necesita !important para ganar a la clase de estado de la
   página (.show/.open, especificidad 0,2,0). */
.modal-bg{ display:flex !important; }
.modal-overlay{ display:flex !important; }
.overlay{ display:block !important; }
.dropdown-menu{ display:block !important; }

.modal-bg, .modal-overlay, .overlay, .dropdown-menu{
  transition: opacity .18s ease, visibility .18s ease;
}
/* estado oculto = sin la clase de estado activa */
.modal-bg:not(.show):not(.open),
.modal-overlay:not(.open),
.overlay:not(.show):not(.open),
.dropdown-menu:not(.open){
  opacity:0; visibility:hidden; pointer-events:none;
}
/* estado visible */
.modal-bg.show, .modal-bg.open,
.modal-overlay.open,
.overlay.show, .overlay.open,
.dropdown-menu.open{
  opacity:1; visibility:visible; pointer-events:auto;
}

/* Caja interior del modal: entra/sale con scale. */
.modal-wrap, .modal-shell, .modal{
  transition: transform .2s ease, opacity .2s ease;
}
.modal-bg:not(.show):not(.open) .modal-wrap,
.modal-bg:not(.show):not(.open) .modal,
.modal-overlay:not(.open) .modal-shell,
.modal-overlay:not(.open) .modal,
.overlay:not(.show):not(.open) .modal{
  transform: scale(.96);
  opacity: 0;
}

/* Dropdown: además del fade, un pequeño slide desde arriba. */
.dropdown-menu{ transform-origin: top; }
.dropdown-menu:not(.open){ transform: translateY(-6px); }
.dropdown-menu.open{ transform: none; }

/* ── Paneles/tabs (informe_wom_app: .panel en flujo normal) ──
   NO forzamos display (rompería el layout de tabs apilando paneles). Solo
   animación de APERTURA al activarse; el cierre es instantáneo (cambio de tab). */
.panel.active{ animation: anim-fade-in .18s ease; }

/* ── Fade-in de página ── */
body{ opacity:0; transform: translateY(6px); transition: opacity .28s ease, transform .28s ease; }
body.loaded{ opacity:1; transform:none; }

@keyframes anim-fade-in{ from{opacity:0} to{opacity:1} }

/* ── Micro-interacciones ──
   Superset de props para NO perder los fades que las páginas ya definen
   (background/border) al reemplazar la transición del botón. */
.btn{ transition: transform .08s ease, box-shadow .15s ease, background .15s ease, border-color .15s ease; }
.btn:hover{ transform: translateY(-1px); }
.btn:active{ transform: translateY(0); }

/* ── Accesibilidad: sin movimiento ── */
@media (prefers-reduced-motion: reduce){
  *, *::before, *::after{ animation:none !important; transition:none !important; }
  body{ opacity:1 !important; transform:none !important; }
}
```

- [ ] **Step 2: Repro de verificación en scratchpad**

Crear `SCRATCH/anim-repro.html` que enlace `http://localhost:3000/animations.css`
y `http://localhost:3000/theme.css`, con un `.modal-overlay` + `.modal-shell`
toggleable por botón (clase `.open`). Servir `animations.css` copiándolo primero
a la raíz del proyecto (el server ya lo sirve estático).

- [ ] **Step 3: Verificar con Playwright**

```python
# measure_anim.py
from playwright.sync_api import sync_playwright
import pathlib
url = pathlib.Path("anim-repro.html").resolve().as_uri()
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    pg.goto(url); pg.wait_for_load_state("networkidle")
    # abre modal
    pg.click("#openBtn")
    op_open = pg.evaluate("getComputedStyle(document.querySelector('.modal-overlay')).opacity")
    print("opacity tras abrir (esperado ~1):", op_open)
    b.close()
```

Run: `uvx --with playwright python measure_anim.py`
Expected: imprime `opacity ... 1` (visible tras abrir). Sin errores.

- [ ] **Step 4: Verificar reduced-motion**

Repetir el script con `p.chromium.launch()` + `b.new_context(reduced_motion="reduce")`.
Expected: modal visible (opacity 1) sin transición; `body` opacity 1.

- [ ] **Step 5: Commit**

```bash
git add animations.css
git commit -m "feat: animations.css compartido (modales, dropdowns, paneles, fade-in, reduced-motion)"
```

---

### Task 2: Crear `animations.js` (fade-in de página)

**Files:**
- Create: `animations.js`
- Verify: Playwright sobre `login.html` (página sin auth) tras incluirlo en Task 3

**Interfaces:**
- Consumes: clase `body.loaded` definida en `animations.css` (Task 1).
- Produces: añade `body.loaded` en `DOMContentLoaded`.

- [ ] **Step 1: Escribir `animations.js`**

```js
/* animations.js — activa el fade-in de página. Mínimo a propósito. */
(function(){
  function reveal(){ document.body.classList.add('loaded'); }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', reveal);
  else reveal();
  // Fallback duro: si algo falla, garantiza visibilidad tras 1s.
  setTimeout(reveal, 1000);
})();
```

- [ ] **Step 2: Commit**

```bash
git add animations.js
git commit -m "feat: animations.js — fade-in de pagina al cargar"
```

---

### Task 3: Incluir los assets en cada página + ajustar selectores por página

**Files:**
- Modify (añadir `<link>` al final del `<style>`/`<head>` y `<script defer>`):
  `login.html`, `landing.html`, `dashboard.html`, `admin.html`, `catalogo.html`,
  `preventivo.html`, `informe_clima_app.html`, `informe_wom_app.html`,
  `perfil.html`, `panel_tecnico.html`, `nuevo_proyecto.html`, `proyecto.html`,
  `ver-informe.html`, `informe-preventivo.html`
- Verify: Playwright sobre `login.html` y `landing.html` (sin auth); resto manual
  por el usuario tras login.

**Interfaces:**
- Consumes: `animations.css` (Task 1), `animations.js` (Task 2).

- [ ] **Step 1: Añadir includes en una página piloto (login.html)**

Justo antes de `</head>` (o tras el `<style>` inline, lo que quede más al final
del head), añadir:

```html
<link rel="stylesheet" href="/animations.css">
<script defer src="/animations.js"></script>
```

- [ ] **Step 2: Verificar login.html con Playwright**

```python
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    pg.goto("http://localhost:3000/login.html"); pg.wait_for_load_state("networkidle")
    print("body loaded (esperado true):", pg.evaluate("document.body.classList.contains('loaded')"))
    print("body opacity (esperado 1):", pg.evaluate("getComputedStyle(document.body).opacity"))
    b.close()
```

Run: `uvx --with playwright python check_login.py`
Expected: `loaded true`, `opacity 1`.

- [ ] **Step 3: Repetir el include en las páginas restantes**

Añadir el mismo par de líneas al `<head>` de cada archivo de la lista Files.
Para cada página, comprobar que el contenedor de modal/dropdown usa uno de los
selectores cubiertos por `animations.css`. Si una página usa un selector NO
cubierto (p.ej. una clase de estado distinta), añadir esa combinación a
`animations.css` en la sección correspondiente (no inventar; usar el real).

- [ ] **Step 4: Verificar landing.html (sin auth) con Playwright**

Igual que Step 2 pero URL `http://localhost:3000/landing.html`. Expected: loaded
true, opacity 1, sin errores de consola.

- [ ] **Step 5: Commit**

```bash
git add login.html landing.html dashboard.html admin.html catalogo.html preventivo.html informe_clima_app.html informe_wom_app.html perfil.html panel_tecnico.html nuevo_proyecto.html proyecto.html ver-informe.html informe-preventivo.html
git commit -m "feat: incluye animations.css/js en todas las paginas de la app"
```

---

### Task 4: Verificación cruzada de modales con display inline (limitación conocida)

**Files:**
- Inspect: `catalogo.html` (toggles por `style.display`, p.ej. tabs línea ~431)
- Modify (solo si trivial): la página afectada

**Interfaces:** ninguna nueva.

- [ ] **Step 1: Localizar toggles `element.style.display=` en JS**

Run (Grep): patrón `\.style\.display\s*=` en `*.html` de la raíz.
Listar los que afectan modales/menús (no tablas/filas internas).

- [ ] **Step 2: Decidir por caso**

Para cada uno: si es un modal/menú y el cambio a clase es trivial (1-2 líneas),
convertir `style.display='none'/'block'` a `classList.remove/add(estado)` para que
herede la animación. Si no es trivial o no es un contenedor animable, dejarlo
documentado como sin animar (coherente con el spec: "no se convierten salvo bajo
bajo esfuerzo").

- [ ] **Step 3: Commit (si hubo cambios)**

```bash
git add -A
git commit -m "feat: engancha animacion en toggles de display triviales"
```

---

### Task 5: Verificación final manual + reduced-motion

**Files:** ninguno (verificación).

- [ ] **Step 1: Checklist manual (usuario)**

Para cada página con modal (admin, catalogo, dashboard, preventivo, informe_clima_app,
informe_wom_app): abrir y cerrar un modal → anima entrada y salida; el backdrop no
bloquea clics cuando está oculto; los dropdowns de preventivo animan; los paneles/tabs
de WOM hacen crossfade.

- [ ] **Step 2: reduced-motion**

En DevTools → Rendering → "Emulate prefers-reduced-motion: reduce": recargar cada
página → sin animaciones, todo visible, contenido nunca invisible.

- [ ] **Step 3: Actualizar graphify**

```bash
graphify update .
```

- [ ] **Step 4: Commit de cierre si aplica**

```bash
git add -A && git commit -m "chore: verificacion animaciones" || true
```

---

## Self-Review

- **Spec coverage:** modales (T1), dropdowns (T1), paneles/tabs (T1), fade-in página
  (T1+T2), micro-interacciones (T1), reduced-motion (T1), includes per-page (T3),
  limitación display-inline (T4), testing manual (T5). Todos los puntos del spec
  tienen tarea.
- **Placeholder scan:** sin TBD/TODO; código real en cada step.
- **Type consistency:** `body.loaded` definido en T1, usado en T2/T3. Selectores
  consistentes con la auditoría del spec.
