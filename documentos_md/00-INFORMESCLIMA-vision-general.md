---
título: "InformesClima — Visión general de la aplicación"
proyecto: InformesClima
version: 3.0.0
repos: [GESTIONTECNICA (gestion), INFORMECORRECTIVOS (origin)]
actualizado: 2026-06-26
tags: [informesclima, arquitectura, documentacion, overview]
---

# InformesClima — ¿Qué es y cómo está hecho?

> Nota maestra del proyecto. Para el detalle de cambios por sesión ver [[2026-06-26-roles-tecnico-y-limpieza]].

---

## 1. ¿Para qué sirve?

Plataforma web **multi-empresa** para **generar y administrar la documentación técnica de mantenimiento de equipos de clima** (aire acondicionado de centrales/telecom). Sustituye el armado manual de informes en Word.

Hace tres cosas principales:

1. **Generar informes** de mantenimiento descargables (Word / PDF) a partir de un formulario + fotos:
   - **TIGO** (informe correctivo/preventivo de clima).
   - **WOM** (informe con su propia plantilla).
2. **Gestionar mantenimiento preventivo**: planificar tareas, asignarlas a técnicos, hacer seguimiento de estado y generar el informe asociado (con QR y PDF).
3. **Administrar usuarios, empresas y permisos** con aislamiento de datos por empresa (multi-tenant).

### ¿Quién la usa?
- **Técnicos**: ven sus tareas/informes asignados, generan informes.
- **Supervisores**: planifican y asignan tareas a sus técnicos.
- **Admin de empresa**: gestionan usuarios y áreas de su empresa.
- **Superadmin**: ve y administra todas las empresas.

---

## 2. Stack tecnológico

| Capa | Tecnología |
|---|---|
| Servidor | **Node.js + Express 4** (`server.js`, monolito ~1900 líneas) |
| Frontend | **HTML/JS vanilla** (sin framework), servido como estático |
| Auth | **JWT** (`jsonwebtoken`) + **bcryptjs** para hashes |
| Base de datos | **Supabase (PostgreSQL)** *o* **SQLite local** (`better-sqlite3`) + JSON |
| Almacenamiento archivos | **Supabase Storage** *o* carpetas locales |
| Generación Word | librería **`docx`** (OpenXML) |
| Generación PDF | **`puppeteer-core`** (HTML → PDF con Chrome) |
| QR | **`qrcode`** |
| Import/Export Excel | **`xlsx-js-style`** / `xlsx` |
| Email | **`nodemailer`** |
| Config | **`dotenv`** |

Arranque: `npm start` (puerto 3000) o `pm2 start ecosystem.config.js` en producción.

---

## 3. Arquitectura

`server.js` es un **monolito** que:
- Sirve las páginas HTML estáticas del root.
- Maneja directamente la generación de informes TIGO/WOM (`/generar`, `/generar-wom`, registros, papelera, descargas).
- Monta cuatro routers extraídos:

| Mount | Router | Maneja |
|---|---|---|
| `/auth` | `routes/auth.js` | Login, usuarios, setup superadmin, áreas |
| `/api/gestion` | `routes/gestion.js` | Gestión de empresas/áreas (admin) |
| `/api` | `routes/empresas.js` | Empresas CRUD, reset password |
| `/tareas` | `routes/preventivo.js` | Mantenimiento preventivo (CRUD, importar, exportar) |

### Páginas (frontend)
Cada página es un HTML con un **interceptor `fetch` inline** que añade `Authorization: Bearer <token>` a toda petición.

| Ruta | Archivo | Para qué |
|---|---|---|
| `/` | `landing.html` | Portada pública |
| `/login` | `login.html` | Inicio de sesión (redirige según rol) |
| `/dashboard` | `dashboard.html` | Nodo central (admin/supervisor) |
| `/panel` | `panel_tecnico.html` | Panel del técnico |
| `/tigo` | `informe_clima_app.html` | Generador de informe TIGO |
| `/wom` | `informe_wom_app.html` | Generador de informe WOM |
| `/preventivo` | `preventivo.html` | Tabla de tareas de mantenimiento |
| `/admin` | `admin.html` | Administración de usuarios/empresas |
| `/perfil` | `perfil.html` | Perfil del usuario |
| `/nuevo-proyecto`, `/proyecto/:slug` | `nuevo_proyecto.html`, `proyecto.html` | Proyectos |

---

## 4. Dualidad de almacenamiento

Toda capa de datos tiene **dos backends** elegidos al arrancar:

```js
const supabase = (SUPABASE_URL && SUPABASE_KEY && USE_LOCAL_DB !== 'true')
  ? createClient(...) : null;
```

- **Con Supabase** → tablas PostgreSQL (`informes_clima`, `papelera_clima`, `informes_wom`, `tareas_preventivo`, `usuarios`, `empresas`, `areas`…) + bucket `documentos-word`.
- **Sin Supabase** → archivos JSON (`registro.json`, `papelera.json`, `tareas_preventivo.json`, `auth.db` SQLite) + carpetas locales (`informes/`, `informes_wom/`, `informes_prev/`).

Patrón en todos los helpers: `if (supabase) { /* PostgreSQL */ } else { /* JSON/SQLite */ }`. Al añadir campos hay que tocar **ambos caminos** y el par de mappers `fromX`/`toX` (camelCase ↔ snake_case).

---

## 5. Autenticación y multi-tenant

- El **JWT** lleva `{ usuario_id, nombre, email, rol, empresa_id, areas_permitidas }`.
- Todas las rutas protegidas pasan por `middleware/auth.js` → opcional `middleware/roles.js`.

### Jerarquía de roles
| Rol | Nivel |
|---|---|
| `superadmin` | 4 (sin empresa, ve todo) |
| `admin_empresa` | 3 |
| `supervisor` | 2 |
| `tecnico` | 1 |

- **Aislamiento por empresa**: cada ruta filtra por `empresa_id` del token. El superadmin (`empresa_id = null`) ve todo.
- **Quién crea a quién**: superadmin→cualquiera, admin_empresa→supervisor/técnico, supervisor→solo técnico.

---

## 6. Flujo de generación de informe (TIGO/WOM)

1. El frontend recoge el formulario + fotos como data-URLs base64.
2. `POST /generar` (o `/generar-wom`) recibe el JSON (hasta 80 MB).
3. `buildDocx(data)` arma el `.docx` con la librería `docx`.
4. El archivo se guarda en `informes/` y se sube a Supabase Storage.
5. Se guarda la metadata en BD y se devuelve el archivo como descarga.

> `codInforme` (p.ej. `YG0806ANTONITX01`) es el identificador visible y parte del nombre del archivo.

---

## 7. Módulo Preventivo

- `routes/preventivo.js` gestiona la tabla `tareas_preventivo` (o el JSON).
- El mapper `fromTarea`/`toTarea` traduce camelCase ↔ snake_case.
- Import XLSX por `POST /tareas/importar` (con `TAREAS_COLUMNAS`).
- Genera el informe preventivo vía **HTML → PDF** (`buildHtmlPreventivo` + `buildPdfPreventivo` con puppeteer), con **QR**.

### Reglas por rol (estado actual)
- **Técnico**: solo ve y filtra (por fecha) **sus** tareas; no puede agregar/editar/borrar/importar (oculto en UI + bloqueado en backend con `requireNivel(2)`). Su panel muestra "Mis tareas pendientes" (estado ≠ `Cerrado`).
- **Supervisor+**: planifican y asignan tareas a técnicos reales de su empresa (dropdown desde `/auth/personal`; `POST /tareas` valida pertenencia a la empresa).

### Estados de tarea
`Nuevo` → `En Progreso` → `Cerrado` (cerrado = no pendiente).

---

## 8. Variables de entorno clave

```
PORT            default 3000
JWT_SECRET      requerido en producción
SUPABASE_URL    opcional — omitir para usar JSON/SQLite local
SUPABASE_KEY    service role key
SUPABASE_BUCKET documentos-word
USE_LOCAL_DB    true → fuerza el modo local aunque haya credenciales Supabase
ADMIN_SECRET    secreto de un solo uso para crear el primer superadmin
```

Crear el primer superadmin tras un deploy:
```bash
curl -X POST http://localhost:3000/auth/register-superadmin \
  -H "Content-Type: application/json" \
  -d '{"nombre":"...","email":"...","password":"...","secret":"<ADMIN_SECRET>"}'
```

---

## 9. Cómo se ha hecho / convenciones

- **Sin framework frontend**: HTML + JS plano, estilos con tokens en `theme.css` (Poppins).
- **Sin test runner ni linter**: se verifica reiniciando el server y probando el endpoint.
- **Un monolito + routers**: la lógica de informes vive en `server.js`; lo demás se extrajo a `routes/`.
- **Dualidad de datos**: cualquier cambio de modelo se hace en los dos backends.
- **Despliegue**: PM2 con auto-reload (`ecosystem.config.js`).
- **Repos git**: remoto `gestion` → **GESTIONTECNICA**; remoto `origin` → **INFORMECORRECTIVOS**.

---

## 10. Deuda técnica conocida
- Tareas vinculan al técnico **por nombre**, no por `usuario_id` (frágil).
- `CLAUDE.md` menciona un rol `encargado_clientes` que no existe en el código (4 roles reales).
- `tareas_informes.json` debería estar en `.gitignore`.
- `server.js` sigue siendo un monolito grande (candidato a más extracción).
