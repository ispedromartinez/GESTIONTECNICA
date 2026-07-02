# Diseño: Módulo Activos/Equipos (hoja de vida)

**Fecha:** 2026-07-02
**Estado:** Aprobado por Pedro
**Objetivo:** Responder "¿cuántas veces falló este equipo y qué se le hizo?" ligando los informes TIGO y WOM existentes a una entidad Equipo con identidad estable, sin cambiar el flujo de trabajo de los técnicos.

## Decisiones tomadas

| Decisión | Elección |
|----------|----------|
| Identidad del equipo | Clave natural `(empresa_id, sitio, numero)` — usa los campos que los informes ya capturan |
| Poblado | Automático al generar informes (upsert); backfill retroactivo desde los registros existentes |
| Fuentes | Informes TIGO (`nombreSitio` + `eqNumero`) y WOM (`instalacion` + `equipo`). Preventivo queda para una iteración futura |
| UI | Pestaña "Equipos" nueva dentro de `catalogo.html` |
| Backend de datos | Dual como toda la app: Supabase y SQLite local |

## Arquitectura

### 1. Tabla `equipos` (resumen, no historial)

```
id                    TEXT PK
empresa_id            TEXT (tenant; null = legado solo visible a superadmin)
sitio                 TEXT NOT NULL   -- nombreSitio (TIGO) / instalacion (WOM)
numero                TEXT NOT NULL   -- eqNumero (TIGO) / equipo (WOM)
tipo                  TEXT            -- eqTipo (TIGO); WOM no lo aporta
marca                 TEXT
modelo                TEXT
total_intervenciones  INTEGER DEFAULT 0
primera_intervencion  TEXT (fecha)
ultima_intervencion   TEXT (fecha)
creado_en / actualizado_en
UNIQUE(empresa_id, sitio, numero)  -- normalizado: trim + lowercase para comparar
```

Es una tabla **caché/resumen**. El detalle de cada intervención vive en `informes_clima` / `informes_wom` (o sus JSON locales); no se duplica.

- Local: `CREATE TABLE IF NOT EXISTS` en `db/local.js` (patrón existente).
- Supabase: script SQL en `schema/equipos.sql`.
- Helper dual `db/equipos.js`: `upsertDesdeInforme()`, `list(empresa_id, sitio?)`, `findById(id)`.

### 2. Alimentación automática

En `POST /generar` (TIGO) y `POST /generar-wom` (WOM), tras el insert del informe:

```
si (sitio && numero de equipo presentes):
  upsert equipos:
    no existe → crear con datos del informe, total=1, primera=ultima=fecha informe
    existe    → total+1, ultima=max(fecha), marca/modelo/tipo ← informe más reciente si trae valor
```

Normalización de clave: `trim()` + colapso de espacios + comparación case-insensitive. Se guarda la grafía original más reciente para mostrar.
El upsert **nunca rompe la generación del informe** (try/catch con log, igual que `vincularInformeGestion`).

### 3. Historial en vivo (sin tabla de historial)

`GET /api/equipos/:id/historial` consulta al momento:
- `informes_clima` donde `nombre_sitio ≈ sitio` y (el nº de equipo del informe ≈ `numero`) — el nº de equipo TIGO no está en la tabla de registro actual, ver §6.
- `informes_wom` donde `instalacion ≈ sitio` (y `equipo ≈ numero` cuando exista, ver §6).

Resultado unificado: `[{ tipo: 'TIGO'|'WOM', id, fecha, codigo, tecnico, filename, urlDescarga }]` ordenado por fecha desc. Links de descarga reusan `/descargar/:id` y `/descargar-wom/:id` (ya validan tenant).

### 4. API

| Ruta | Auth | Descripción |
|------|------|-------------|
| `GET /api/equipos?sitio=&q=` | authMiddleware + scopeToTenant | Lista de equipos del tenant, filtro por sitio y búsqueda libre |
| `GET /api/equipos/:id/historial` | authMiddleware + canAccessTenant | Timeline de informes del equipo |
| `POST /api/equipos/backfill` | requireRol('superadmin') | Recorre informes existentes y puebla `equipos` (idempotente: reconstruye contadores desde cero) |

### 5. Frontend — pestaña "Equipos" en catalogo.html

- Tabs arriba: **Sitios** (actual) | **Equipos** (nuevo).
- Tabla: Sitio · N° equipo · Tipo · Marca/Modelo · Intervenciones (badge) · Última intervención. Buscador libre + filtro por sitio. Mismo estilo de tabla/toolbar que la vista de sitios.
- Click en fila → panel modal con la ficha: datos del equipo + timeline de informes (fecha, origen TIGO/WOM, código, técnico, botón ⬇ descargar).
- Todo texto de datos escapado con `esc()` (ya existe en la página).
- Botón "Recalcular" (solo superadmin) → llama al backfill.

### 6. Vínculo informe→equipo para el historial

La tabla `informes_clima` de registro NO guarda hoy `eq_numero` (solo va dentro del docx). Para que el historial funcione:

- **Columna nueva** `eq_numero` en `informes_clima` (y `eqNumero` en el JSON local) — se llena al generar desde ahora.
- WOM: columna nueva `equipo` en `informes_wom` (registro actual no la guarda).
- Migración idempotente (ALTER TABLE catch en local; SQL en `schema/` para Supabase).
- **Informes históricos** sin esa columna: el backfill no puede ligarlos por número → el historial muestra solo informes generados después del cambio, más un fallback: informes antiguos del mismo *sitio* se listan en una sección "otros informes del sitio (sin nº de equipo)" para no perder contexto.

### 7. Manejo de errores

- Upsert de equipos en `/generar*`: falla silenciosa con `console.error` — jamás bloquea la entrega del informe.
- Historial de un equipo inexistente o de otro tenant → 404/403 vía `canAccessTenant`.
- Backfill reporta `{ procesados, equiposCreados, errores }`.

### 8. Verificación (manual, modo local)

1. Generar informe TIGO con sitio+equipo nuevos → aparece en `GET /api/equipos` con total=1.
2. Segundo informe mismo equipo → total=2, `ultima_intervencion` actualizada.
3. Informe WOM misma clave → suma al mismo equipo.
4. Historial devuelve ambos informes con links de descarga funcionales.
5. Usuario de otra empresa no ve el equipo (aislamiento tenant).
6. Backfill con registros existentes → contadores correctos, re-ejecutar no duplica.
7. Pestaña Equipos: búsqueda, filtro por sitio, ficha con timeline, descarga.

## Fuera de alcance

- Equipos de informes preventivos (array `equipos` por tarea) — iteración futura.
- Edición manual de la ficha (fecha instalación, notas, fotos del activo) — iteración futura.
- Inventario de repuestos — módulo siguiente, spec aparte.
