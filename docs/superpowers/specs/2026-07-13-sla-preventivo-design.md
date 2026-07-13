# Dashboard de cumplimiento SLA — Preventivo

## Objetivo

Dar al supervisor/admin (y al gerente de la empresa cliente) una vista de
qué tan al día está el mantenimiento preventivo: % de tareas cumplidas a
tiempo, cuántas vencidas, desglosado por técnico y por sitio. Convierte la
app de "generador de tareas" en herramienta de gestión.

## Reglas SLA

Universo: tareas de `tareas_preventivo` con `fechaVencimiento`. Cada una se
clasifica:

- **a_tiempo**: estado `Cerrado` y `estadoCambiadoEn` (fecha de cierre) ≤
  `fechaVencimiento`.
- **tarde**: `Cerrado` pero cerrada después del vencimiento.
- **vencida**: abierta (no `Cerrado`) y `fechaVencimiento` < hoy.
- **en_plazo**: abierta y `fechaVencimiento` ≥ hoy (todavía puede cumplirse).

**% SLA** = a_tiempo / (a_tiempo + tarde + vencida). Las `en_plazo` no
penalizan aún.

## Backend — `GET /tareas/sla`

Montado bajo `/tareas` (requiere módulo preventivo). Aislado por empresa
(`filtraEmpresa`). Recorte por rol: superadmin/admin ven toda la empresa;
supervisor solo sus técnicos a cargo (`supervisor_tecnico`, match por
nombre); técnico solo lo suyo. Filtro opcional `desde`/`hasta` sobre
`fechaVencimiento`.

Devuelve `{ global, porTecnico[], porSitio[] }` donde cada bloque trae los 4
conteos + `total` + `sla` (% o null si no hay base).

## Frontend — pestaña "SLA Preventivo" en dashboard

Visible para supervisor+. Muestra:
- % SLA global (color: ≥90 verde, ≥70 ámbar, <70 rojo) + 4 conteos.
- Tabla por técnico (ordenada por peor SLA primero).
- Tabla de sitios con tareas vencidas (ordenada por más vencidas).
- Filtro por rango de fecha de vencimiento.
- Si la empresa no tiene preventivo (403), mensaje claro.

## Tests

`test/sla-preventivo.test.js`: crea 4 tareas (una de cada clase), verifica
la clasificación y que %SLA = 33 (1 a tiempo de 3 que cuentan), y el
desglose por técnico. Modo local.
