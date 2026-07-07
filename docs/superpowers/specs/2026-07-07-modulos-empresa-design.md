# Módulos por empresa (Tigo / WOM / Preventivo)

## Problema

`dashboard.html` muestra 3 tarjetas fijas (Proyecto Tigo, Proyecto WOM, Preventivo) a
**cualquier** usuario logueado, sin importar su empresa. No hay forma de que el
superadmin decida qué módulos ve/usa cada empresa cliente. Tampoco hay bloqueo en
backend: un técnico que conozca la URL o el endpoint puede generar informes de un
módulo que su empresa no debería tener.

La creación de empresas (`POST /api/empresas`) y el sistema genérico de "proyectos"
(tabla `proyectos`, gestionado en `routes/gestion.js`) ya existen y no cambian. Esto
es exclusivamente sobre los 3 módulos fijos legacy (Tigo/WOM/Preventivo, manejados en
`server.js` + `routes/preventivo.js`).

## Modelo de datos

Tabla `empresas`: 3 columnas nuevas, boolean-ish (INTEGER 0/1 en SQLite, boolean en
Supabase), default `true`/`1` para no romper empresas existentes:

- `modulo_tigo`
- `modulo_wom`
- `modulo_preventivo`

SQLite (`db/local.js`): migración idempotente vía `ALTER TABLE ... ADD COLUMN ... DEFAULT 1`,
mismo patrón que `rut_empresa`/`nombre_fantasia`. También hay que sumar las 3 columnas
al INSERT fijo de `local.empresas.insert`.

Supabase (`schema/extension.sql`): agregar el `ALTER TABLE` equivalente. Esto **no se
ejecuta solo** — hay que correrlo manualmente en el SQL editor de Supabase si el
proyecto usa ese backend (el repo no tiene runner de migraciones remoto).

## Backend — API empresas (`routes/empresas.js`)

- `POST /api/empresas`: acepta `modulo_tigo`, `modulo_wom`, `modulo_preventivo`
  (boolean, default `true` si no vienen).
- `PUT /api/empresas/:id`: los 3 flags solo los puede tocar `superadmin` (mismo
  criterio que `slug`/`activa` — decisión de plataforma, no del cliente).
- `GET /api/empresas` y `GET /api/empresas/:id`: los devuelven tal cual (ya hacen
  `SELECT *` / pasan el objeto completo, no requieren cambio de proyección).

## Backend — `/auth/me` (`routes/auth.js`)

Se agrega `modulos: { tigo, wom, preventivo }` a la respuesta:

- `superadmin` (empresa_id null): siempre `{ tigo: true, wom: true, preventivo: true }`.
- Resto de roles: se busca la empresa (`gestionDB.empresaById(req.user.empresa_id)`) y
  se devuelven sus flags reales (tratando `undefined`/`null` como habilitado, para
  compatibilidad con filas viejas antes de la migración).

## Frontend — `dashboard.html`

Las 3 tiles estáticas (líneas ~525, ~537, ~549) ganan `id="tileTigo"`, `id="tileWom"`,
`id="tilePreventivo"`. Después del fetch existente a `/auth/me` (línea ~771), se oculta
(`style.display='none'`) cada tile cuyo flag correspondiente sea `false`. No se agregan
requests nuevos.

## Frontend — `admin.html`

- `modalEmpresa()` (crear): 3 checkboxes "Tigo" / "WOM" / "Preventivo", marcados por
  defecto. `crearEmpresa()` los manda en el body.
- `modalEditarEmpresa()` (editar): mismos 3 checkboxes dentro del bloque `camposSuper`
  (solo visibles/editables si `ME.rol === 'superadmin'`), reflejando el valor actual
  de la empresa. `guardarEmpresa()` los incluye en el body solo si el bloque existe en
  el DOM (mismo patrón que `eeSlug`/`eeActiva`).

## Backend — enforcement (nuevo `middleware/modulos.js`)

`requireModulo(modulo)` — middleware factory:

```js
function requireModulo(modulo) {
  return async (req, res, next) => {
    if (req.user.rol === 'superadmin') return next();
    const empresa = await gestionDB.empresaById(req.user.empresa_id);
    const campo = `modulo_${modulo}`;
    if (empresa && (empresa[campo] === 0 || empresa[campo] === false))
      return res.status(403).json({ error: `Tu empresa no tiene habilitado el módulo ${modulo}` });
    next();
  };
}
```

Se aplica en `server.js`, después de `authMiddleware`, a:

- **Tigo** (`requireModulo('tigo')`): `/generar`, `/registro`, `/descargar/:id`,
  `/ver-pdf/:id`, `/enviar/:id`, `DELETE /registro/:id`, `/papelera`,
  `/papelera/restaurar/:id`, `DELETE /papelera/:id`, `DELETE /papelera`.
- **WOM** (`requireModulo('wom')`): `/generar-wom`, `/registro-wom`,
  `/descargar-wom/:id`, `/ver-pdf-wom/:id`, `DELETE /registro-wom/:id`,
  `/papelera-wom`, `/papelera-wom/restaurar/:id`, `DELETE /papelera-wom/:id`,
  `DELETE /papelera-wom`.
- **Preventivo** (`requireModulo('preventivo')`): mount completo `app.use('/tareas', ...)`,
  más `/generar-preventivo`, `/registro-prev`, `/descargar-prev/:id`,
  `DELETE /registro-prev/:id`.

Fuera de alcance: `/api/sitios-preventivos*` (catálogo compartido, ya protegido por
`requireNivel(3)`, no por módulo — es infraestructura, no una acción del módulo en sí).

## Fuera de alcance

- El sistema genérico de "proyectos" (tabla `proyectos`, `routes/gestion.js`) no
  cambia — sigue siendo independiente de estos 3 módulos fijos.
- No se agregan nuevos roles ni se cambia la jerarquía existente.
- No se migra Tigo/WOM/Preventivo al modelo de "proyectos" genérico — quedan como
  módulos legacy gateados por empresa.
