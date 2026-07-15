# Visor de Auditoría — Diseño

**Fecha:** 2026-07-15
**Autor:** Pedro Martinez (con Claude)
**Estado:** Aprobado, listo para plan de implementación

## Objetivo

Dar a `admin_empresa` (y `superadmin`) visibilidad sobre el log de auditoría
existente: quién hizo qué acción sensible y cuándo, dentro de su empresa. Hoy
el backend registra las acciones pero no hay UI para verlas — el admin no tiene
control/visibilidad de las altas/bajas de usuarios ni de los vínculos técnicos.

## Alcance

**Solo UI.** Cero cambios de backend. El endpoint y su role-scoping ya existen:

- `GET /api/gestion/auditoria` (`routes/gestion.js:15`) — `requireRol('superadmin','admin_empresa')`.
  - `admin_empresa` → auto-filtrado a `req.user.empresa_id`.
  - `superadmin` → todas las empresas (o filtra por `?empresa_id=`).
  - Devuelve hasta 300 filas, orden `fecha` descendente.
- `db/auditoria.js` → `listar()` lee tabla Supabase `auditoria` o `auditoria.json`.

**Acciones auditadas hoy (6, no se amplían en este trabajo):** `crear`/`borrar`
empresa, `crear`/`borrar` usuario, `vincular`/`desvincular` supervisor_tecnico.

Fuera de alcance (explícito): ampliar el logging (informes, login, contraseña,
edición de proyecto), export CSV/Excel, paginación server-side.

## Forma de una fila (del backend)

```json
{
  "id": "1784...pt",
  "fecha": "2026-07-15T15:50:41.323Z",
  "usuario_id": "f033...",
  "usuario_email": "martinezagueropedro@gmail.com",
  "empresa_id": null,
  "accion": "borrar",
  "entidad": "usuario",
  "entidad_id": "feab...",
  "detalle": null
}
```

`detalle` es un string JSON (a veces `null`), ej. `{"nombre":"...","email":"..."}`.

## Componentes (todo en `admin.html`)

`admin.html` es una SPA: sidebar `MENU[ME.rol]` → `go('vista')` → renderiza en
`#content`. Se sigue ese patrón.

1. **Item de navegación.** Agregar `auditoria` al `MENU` de `superadmin` y
   `admin_empresa`: `{ id:'auditoria', label:'Auditoría', ico:'📋' }`.

2. **`vistaAuditoria()`** — función de render:
   - `fetch('/api/gestion/auditoria')` (el interceptor JWT agrega el Bearer).
   - Guarda las filas en una variable de módulo `AUDIT_ROWS` para filtrar
     client-side sin re-fetch.
   - Llama a `renderAuditTabla()` con las filas filtradas.

3. **`renderAuditTabla(rows)`** — construye la tabla:
   - Columnas: Fecha/hora | Usuario (email) | Acción | Entidad | Detalle.
   - Orden ya viene fecha desc del backend.
   - Fecha: formateada legible (`toLocaleString('es-CL')` o equivalente).
   - Acción+entidad legibles vía mapa: `crear+usuario`→"Creó usuario",
     `borrar+proyecto`→"Borró proyecto", `vincular+supervisor_tecnico`→
     "Vinculó técnico", etc. Fallback: `${accion} ${entidad}` si no hay mapeo.
   - Badge de color por acción: crear=verde, borrar=rojo,
     vincular/desvincular=azul.
   - Detalle: si es JSON parseable, mostrar campos clave compactos
     (ej. `nombre`/`email`); si `null`, mostrar "—".

4. **Filtros (client-side sobre `AUDIT_ROWS`):**
   - Dropdown **Acción** (opciones únicas presentes en los datos).
   - Input **Usuario** (substring case-insensitive sobre `usuario_email`).
   - Buscador **texto** (matchea `entidad` / `detalle` / `usuario_email`).
   - Se combinan (AND). Cada cambio → recomputa filtro → `renderAuditTabla()`.

## Data flow

```
go('auditoria')
  → vistaAuditoria()
      → fetch /api/gestion/auditoria  (backend ya scoping por rol/empresa)
      → AUDIT_ROWS = filas
      → pinta layout (filtros + contenedor tabla)
      → renderAuditTabla(AUDIT_ROWS)
  → usuario cambia un filtro
      → aplicarFiltros() computa subset de AUDIT_ROWS
      → renderAuditTabla(subset)
```

## Seguridad (MANDATORIO)

Todo dato del servidor renderizado en `innerHTML` va por `esc()` (helper de
`common.js`): `usuario_email`, `entidad`, `entidad_id`, y cualquier valor de
`detalle`. Es dato originado por usuarios (emails, nombres) → sin escapar es
stored-XSS, y el JWT vive en `localStorage`. Si algún control lleva el valor
dentro de `onclick="..."`, usar `escArg()`. Ver regla XSS en `CLAUDE.md`.

`admin.html` ya carga `common.js`, así que `esc`/`escArg` están disponibles.

## Estados / manejo de error

- **Loading:** placeholder mientras el `fetch` está en curso.
- **Vacío:** filas = 0 → "Sin registros de auditoría".
- **Filtro sin resultados:** "Ningún registro coincide con los filtros".
- **Error de fetch:** mensaje de error + botón reintentar; nunca romper la SPA.

## Testing / verificación

- Modo local (`USE_LOCAL_DB=true`), servidor en `localhost:3000`.
- Login como `superadmin` → ver item "Auditoría" → tabla con registros
  (crear/borrar/vincular reales generados por operaciones de prueba).
- Login como `admin_empresa` → ver solo registros de su empresa (aislamiento).
- Verificar filtros: por acción, por usuario, por texto; combinados.
- Verificar en consola del navegador: sin errores JS; un `detalle`/email con
  caracteres HTML (`<`, `'`) se muestra escapado, no ejecuta.
- Confirmar que un rol sin permiso (`tecnico`/`supervisor`) no ve el item ni
  puede pegar al endpoint (403, ya cubierto por el backend).

## Archivos tocados

- `admin.html` — único archivo. Nav item + `vistaAuditoria()` +
  `renderAuditTabla()` + filtros + estilos de badges.
