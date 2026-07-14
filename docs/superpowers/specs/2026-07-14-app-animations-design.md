# Diseño — Animaciones de apertura/cierre en la app

Fecha: 2026-07-14

## Objetivo

Añadir animaciones suaves y consistentes en toda la app de informes:
modales, menús/dropdowns, fade-in de página y micro-interacciones de
botones/inputs. Sin regresiones funcionales y respetando accesibilidad
(`prefers-reduced-motion`).

## Arquitectura

Dos ficheros compartidos nuevos en la raíz del proyecto:

- `animations.css` — todas las reglas de animación.
- `animations.js` — solo lo que CSS no cubre (fade-in de página, stagger opcional).

Cada página los incluye en `<head>`:

```html
<link rel="stylesheet" href="/animations.css">
<script defer src="/animations.js"></script>
```

Servidos por `express.static(__dirname)` (ya activo). Es **per-page** como
`esc()`: no se hereda, hay que añadir el include a cada página. A diferencia
de `esc()`, es solo presentación → sin riesgo XSS/token, seguro compartir.

**Orden de carga:** el `<link>` a `animations.css` debe ir **después** del
`<style>` inline de cada página para ganar la cascada y poder sobrescribir el
patrón `display:none/flex` de los modales existentes.

## Principio técnico clave

El patrón dominante hoy es togglear `display:none ↔ display:flex/block` con una
clase de estado. `display` **no** es animable por CSS. La solución sin tocar JS:

- Estado base del contenedor: `visibility:hidden; opacity:0; transform:...;
  pointer-events:none; transition:...` (en vez de `display:none`).
- Clase de estado activa: revierte a `visibility:visible; opacity:1;
  transform:none; pointer-events:auto`.

Así la `transition` de CSS anima **tanto abrir como cerrar** cuando el JS
existente hace `classList.add/remove(...)`. Cero cambios en el JS de las páginas.

## Mapa de selectores (auditoría real)

`animations.css` debe apuntar a las combinaciones reales encontradas:

| Página | Contenedor.estado |
|---|---|
| catalogo.html | `.modal-bg.show` |
| admin.html | `.modal-bg.open`, `.overlay.open` |
| dashboard.html | `.overlay.show` |
| informe_clima_app.html | `.modal-overlay.open` |
| informe_wom_app.html | `.panel.active` |
| preventivo.html | `.modal-overlay.open`, `.dropdown-menu.open` |
| login / landing / nuevo_proyecto / proyecto / perfil / panel_tecnico / informe-preventivo / ver-informe | auditar al implementar y añadir combos que falten |

Se agrupan selectores por comportamiento (modal center, overlay backdrop,
dropdown, panel/tab) para no repetir reglas.

## Componentes de animación

1. **Modales (centrados)** — backdrop: fade de opacidad. Caja interior: `fade +
   scale(.96 → 1)` al abrir, inverso al cerrar. ~180–220ms, `ease`.
2. **Dropdowns/menús** — `transform-origin:top`, slide-down + fade (`scaleY` o
   `translateY(-6px)`), ~150ms.
3. **Paneles/tabs** (`.panel.active`, `.modal-tabs`) — crossfade suave.
4. **Fade-in de página** — `body` arranca `opacity:0; translateY(6px)`;
   `animations.js` añade `body.loaded` en `DOMContentLoaded` → transición a
   estado normal. Fallback: si JS no corre, regla de seguridad que deja el body
   visible (no bloquear contenido).
5. **Micro-interacciones** — `transition` en botones (hover: lift/box-shadow) e
   inputs (focus). Aplicadas por clases genéricas ya existentes donde sea seguro;
   evitar tocar botones con transición propia ya definida.

## Accesibilidad (obligatorio)

```css
@media (prefers-reduced-motion: reduce){
  *{ animation:none !important; transition:none !important; }
  /* garantizar visibilidad final sin transición */
}
```

## Casos que NO se animan (limitaciones conocidas)

- Toggles con `element.style.display='none'` **inline** en JS (ej.
  catalogo.html:431 tabs por `style.display`): CSS no puede animar porque el JS
  fuerza `display`. Quedan sin animación o requieren tweak puntual en esa página.
  Se listan al implementar; no se convierten salvo bajo bajo esfuerzo.

## Testing

Manual, sin runner (coherente con el repo):

- Abrir/cerrar cada modal en cada página → anima entrada y salida.
- Backdrop no captura clics cuando está oculto (`pointer-events:none`).
- Dropdowns de preventivo animan y cierran bien.
- `prefers-reduced-motion` activo (DevTools) → sin animaciones, todo visible.
- Recarga de cada página → fade-in, contenido nunca queda invisible.

## Fuera de alcance (YAGNI)

- Librerías de animación (GSAP, Framer, etc.).
- Transiciones entre páginas tipo SPA (la app es multipágina server-rendered).
- Reescribir toggles `style.display` inline a clases (solo si trivial).
