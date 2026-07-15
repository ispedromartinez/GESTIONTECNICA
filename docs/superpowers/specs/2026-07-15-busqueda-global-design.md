# Búsqueda Global — Diseño

**Fecha:** 2026-07-15
**Estado:** Aprobado, listo para plan de implementación

## Objetivo

Un buscador único que cruce **informes** (Tigo/WOM legacy), **sitios**,
**equipos** y **técnicos**, desde el header del dashboard, para todos los roles.
Los resultados se aíslan por rol/empresa en el servidor. Al hacer click en un
resultado se muestra un popover con sus datos clave (sin navegar).

## Arquitectura

**Backend:** un endpoint `GET /api/buscar?q=<texto>` (con `authMiddleware`).
Consulta las 4 fuentes, filtra por coincidencia, aplica scoping por rol y
devuelve resultados agrupados:

```json
{ "informes": [...], "sitios": [...], "equipos": [...], "tecnicos": [...] }
```

- Sigue el patrón `if (supabase) { … } else { … }` de cada fuente.
- Máximo 8 resultados por tipo (top tras filtrar).
- `q` con menos de 2 caracteres (tras trim) → responde `{ informes:[],
  sitios:[], equipos:[], tecnicos:[] }` sin consultar nada.
- No bloqueante: si una fuente falla, ese grupo va vacío y se loguea el error;
  el endpoint nunca devuelve 500 por una fuente caída (patrón de auditoría/equipos).

**Frontend:** barra de búsqueda en el header de `dashboard.html` (visible para
todos los roles), con panel dropdown de resultados agrupados. Todo dato del
servidor se escapa con `esc()` (y `escArg()` en `onclick`). Click en resultado
→ popover con datos clave.

## Fuentes y campos

| Fuente | Cargar con | Campos buscados | Datos del resultado |
|--------|-----------|-----------------|---------------------|
| Informe clima | `registro.json` / tabla `informes` clima (`dbClima*`) | `codInforme`, `nombreSitio`, `codigoSitio`, `tecnico`, `numOT`, `eqNumero` | tipo=`Tigo`, id, codInforme, nombreSitio, tecnico, fecha, filename |
| Informe WOM | `registro_wom.json` / tabla WOM | `codInforme`, `nombreSitio`, `codigoSitio`, `tecnico`, `numOT`, `equipo` | tipo=`WOM`, id, codInforme, nombreSitio, tecnico, fecha, filename |
| Sitio | `db/sitios.js` `list()` | nombre, código, dirección | nombre, código, dirección, módulo |
| Equipo | `db/equipos.js` `list()` | número, sitio, marca, modelo | número, sitio, marca, modelo, #intervenciones |
| Técnico (usuario) | `db/gestion` `usuariosList()` | nombre, email | nombre, email, rol, empresa |

Cada resultado incluye `tipo` (`informe`|`sitio`|`equipo`|`tecnico`) e `id`.

## Coincidencia (match)

- Substring, case-insensitive, **sin acentos**: normalizar query y campos con
  `String(x).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()`.
- La `q` (normalizada) debe estar contenida en al menos uno de los campos
  buscados de la fila.
- Helper reutilizable `matchTexto(q, ...campos)` → boolean.

## Scoping por rol (server-side, obligatorio)

Un helper central `scopeBusqueda(req, tipo, filas)` aplica, según `req.user.rol`:

| Fuente | superadmin | admin_empresa | supervisor | tecnico |
|--------|-----------|---------------|------------|---------|
| Informes | todos | `empresaId === user.empresa_id` | empresa **Y** `tecnico` ∈ nombresPermitidos | empresa **Y** `tecnico` === nombrePropio |
| Sitios | todos | empresa | empresa | empresa |
| Equipos | todos | empresa | empresa | empresa |
| Técnicos | todos | empresa | él + sus técnicos asignados | solo él |

- `nombresPermitidos` (supervisor) = nombres de {el propio supervisor + sus
  técnicos asignados vía `db.tecnicosDeSupervisor(usuario_id)`}. El match de
  informes es por **nombre de texto** (`tecnico`), no por id, porque los
  informes legacy guardan el técnico como texto (mismo criterio que el spec de
  Reportes 2026-07-13).
- `nombrePropio` = nombre display del usuario. El JWT NO lo trae (solo
  `usuario_id`, `rol`, `empresa_id`, `areas_permitidas`), así que `scopeBusqueda`
  lo resuelve server-side vía `db.usuarioById(req.user.usuario_id).nombre`.
  Igual para los técnicos del supervisor: `db.tecnicosDeSupervisor()` ya devuelve
  sus nombres. La comparación de nombres se hace normalizada (sin acentos,
  lowercase, trim) para tolerar diferencias de tipeo.
- Empresa: `empresaId`/`empresa_id` de la fila === `user.empresa_id`. Superadmin
  (`empresa_id === null`) ve todo. Reutiliza la semántica de `canAccessTenant`.
- Sitios/equipos no pertenecen a un técnico → se ven a nivel empresa para todos
  los roles de esa empresa (decisión de diseño confirmada).

## UI, flujo y estados

- Barra en el header de `dashboard.html`. Al tipear (≥2 chars tras trim,
  debounce 250 ms) → `GET /api/buscar?q=` con el interceptor JWT.
- Panel dropdown: secciones por tipo con encabezado y contador; cada ítem es una
  línea compacta. Secciones vacías no se muestran.
- Click en ítem → popover con datos clave (§ Fuentes). Cerrar con Esc o click
  afuera. El popover no hace más requests (usa datos ya recibidos).
- Teclado: ↑/↓ mueve selección, Enter abre popover del seleccionado, Esc cierra
  el dropdown.
- Estados: `q<2` → "Escribe 2+ caracteres"; en vuelo → "Buscando…"; 0 resultados
  → "Sin resultados para «q»"; error de red → mensaje discreto + posibilidad de
  reintentar al seguir tipeando.

```
input (≥2, debounce 250ms)
  → GET /api/buscar?q=
      server: por fuente → cargar → filtrar matchTexto → scopeBusqueda(req,tipo,filas) → top 8
      → { informes, sitios, equipos, tecnicos }
  → cliente: render agrupado (todo esc()) → click → popover
```

## Seguridad

- Scoping SIEMPRE en el servidor (`scopeBusqueda`); el cliente nunca recibe
  datos fuera de su alcance. Nunca confiar en filtros del cliente.
- XSS: todo dato del servidor renderizado en `innerHTML` pasa por `esc()`;
  dentro de `onclick="..."` por `escArg()`. `dashboard.html` ya carga
  `common.js`. Ver regla XSS en `CLAUDE.md`.
- El endpoint valida `q` (longitud, tipo) antes de consultar.

## Manejo de errores

- Cada fuente se envuelve en try/catch: si falla, su grupo va `[]` y se
  `console.error`; el endpoint responde 200 con lo que sí se pudo.
- `q` ausente o no-string → tratar como vacío (grupos vacíos), no 400 que rompa
  la UX de tipeo.

## Testing

- Smoke test (`node:test`, modo local `USE_LOCAL_DB=true`, no toca prod):
  - Crear empresa A, superadmin, admin A, supervisor S con técnico T asignado, y
    técnico U no asignado a S. Generar informes con `tecnico` = nombre de T y de U.
  - `GET /api/buscar?q=<algo>`:
    - técnico U → ve informes de U, NO los de T.
    - supervisor S → ve informes de T (su técnico), NO los de U.
    - admin A → ve todos los de empresa A.
    - aislamiento: usuario de empresa B → NO ve nada de A.
  - `q` con 1 char → grupos vacíos.
- Verificación en navegador: dropdown agrupado, popover, y un resultado con
  `<`/`'` en un campo se muestra escapado (no ejecuta).

## Archivos tocados

- `server.js` — endpoint `GET /api/buscar` + helpers `matchTexto`,
  `scopeBusqueda`, y la carga de cada fuente (reusando helpers existentes de
  clima/wom/sitios/equipos/usuarios).
- `dashboard.html` — barra de búsqueda, dropdown, popover, estilos.
- `test/busqueda.test.js` — smoke de scoping por rol.
