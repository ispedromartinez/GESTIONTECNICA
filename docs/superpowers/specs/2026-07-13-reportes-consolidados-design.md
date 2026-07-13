# Vista consolidada de reportes (Tigo/WOM/Preventivo)

## Contexto y objetivo

El técnico genera informes Word (Tigo/WOM/Preventivo). Hoy no hay un lugar
único donde el supervisor/admin vea todos los reportes de su equipo. El
objetivo es **visibilidad**: quién reportó qué, cuándo y en qué sitio. Sin
aprobación ni gates — el informe generado ES el reporte.

## Alcance

Una pestaña nueva "Reportes" en el dashboard que lista los informes
generados de los 3 módulos, consolidados, filtrables y descargables.

Fuera de alcance: aprobación/rechazo, edición del informe, notificaciones.

## Backend — `GET /api/reportes`

Agrega los 3 orígenes (`informes_clima`, `informes_wom`, `informes_prev`)
normalizados a una fila común:

```
{ id, modulo: 'tigo'|'wom'|'preventivo', sitio, tecnico, fecha,
  codigo, filename, descargaUrl }
```

Reglas:
- **Aislamiento por empresa**: se aplica `filtrarInformesPorEmpresa` (ya
  existe) a cada origen antes de unir.
- **Rol**:
  - superadmin / admin_empresa: todos los reportes de la empresa.
  - supervisor: solo los de sus **técnicos a cargo** (vía
    `supervisor_tecnico` → nombres de esos usuarios → match contra el campo
    `tecnico` del informe, case-insensitive). El match es por nombre porque
    los informes guardan el técnico como texto, no como id.
  - tecnico: solo los suyos (match por su propio nombre).
- **Filtros** (query params, opcionales): `modulo`, `tecnico` (substring),
  `desde`, `hasta` (fecha ISO).
- Devuelve `{ reportes: [...], stats: { total, mes, porModulo } }`.

`descargaUrl` apunta al endpoint de descarga que corresponde al módulo
(`/descargar/:id`, `/descargar-wom/:id`, `/descargar-prev/:id`).

## Frontend — pestaña "Reportes" en dashboard.html

- Nueva entrada de navegación + vista `view-reportes`.
- Cabecera con stats (total, este mes, desglose por módulo).
- Controles de filtro: módulo (select), técnico (input), rango de fechas.
- Tabla: Módulo · Sitio · Técnico · Fecha · Código · [Descargar].
- Escapar todo con `esc()` (de /common.js) antes de innerHTML.

## Tests

Añadir a la suite (modo local): un test que, como admin, liste reportes y
verifique que respeta el aislamiento por empresa (no aparecen reportes de
otra empresa). Reusar la infraestructura de smoke/tenant-isolation.
