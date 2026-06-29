---
título: "Preventivo — Roles del técnico, asignación a usuarios reales y limpieza de código"
fecha: 2026-06-26
proyecto: InformesClima
commit: 0a5d13e
remoto: gestion (GESTIONTECNICA)
tags: [informesclima, preventivo, roles, refactor, limpieza]
---

# Resumen de la sesión — 2026-06-26

Trabajo sobre el módulo **Preventivo** y limpieza general. Tres grandes bloques:
1. Revisión de código muerto/duplicado.
2. Roles del técnico (qué ve y qué puede hacer).
3. Asignación de tareas conectada a usuarios reales.

Cerrado con commit `0a5d13e` y **push al remoto `gestion` (GESTIONTECNICA)**.

---

## 1. Limpieza de código muerto

### Qué se quitó de `server.js`
- `buildDocxWom_UNUSED()` — función ya reemplazada, nunca llamada.
- `buildDocxPreventivo()` — generador DOCX sustituido por el flujo HTML→PDF (`buildHtmlPreventivo` + `buildPdfPreventivo`).
- `const LOGO_B64` — constante que leía `logo.jpeg` en cada arranque sin usarse nunca.

> Resultado: `server.js` pasó de **2430 → 1906 líneas** (~524 líneas muertas eliminadas).

### Páginas HTML huérfanas eliminadas
- `selector.html` — reemplazada por el dashboard (`/selector` redirige a `/dashboard`).
- `preview_monday.html` — maqueta de diseño ("PREVIEW – Estética Monday.com"), sin ruta ni enlaces.

> Verificado: ninguna referencia viva (solo aparecían en comentarios).

---

## 2. Roles del técnico

### Jerarquía de roles (`middleware/roles.js`)
| Rol | Nivel | Alcance |
|---|---|---|
| `superadmin` | 4 | `empresa_id = null`, ve todo |
| `admin_empresa` | 3 | Toda su empresa |
| `supervisor` | 2 | Su empresa / áreas |
| `tecnico` | 1 | Solo lo suyo |

### Qué cambió para el rol `tecnico`
**Frontend (`preventivo.html`):**
- Se ocultan las acciones de supervisor: **Agregar tarea / Editar / Borrar / Herramientas**.
- Se oculta el **selector de técnico** (un técnico solo se ve a sí mismo).
- Se **conservan** los filtros por fecha (Semana / Desde / Hasta).

**Backend (`routes/preventivo.js`):**
- `requireNivel(2)` en `POST /`, `PUT /:id`, `DELETE /:id`, `POST /importar` → un técnico que llame la API directamente recibe **403**.
- `GET /tareas` acota automáticamente a las tareas del propio técnico (match por nombre: `tarea.tecnico === usuario.nombre`).

### Panel del técnico (`panel_tecnico.html`)
- La sección **"Tareas"** dejó de ser un placeholder.
- Nueva tarjeta **"Mis tareas pendientes"** en el panel principal y en la página Tareas.
- "Pendiente" = estado distinto de **`Cerrado`** (Nuevo, En Progreso).

---

## 3. Asignación de tareas conectada a usuarios reales

### La falla encontrada
El dropdown de técnico en `preventivo.html` se llenaba desde un **array hardcodeado** (`TECHNICIANS`), desconectado de los usuarios reales. Consecuencias:
- El supervisor solo podía asignar a 7 nombres fijos.
- Esos nombres no eran usuarios del sistema → los técnicos reales **nunca recibían tareas**.
- Rompía el multi-tenant (lista igual para todas las empresas).

### La corrección
**(1) Frontend:** el dropdown se llena desde **`GET /auth/personal`** (técnicos reales de la empresa). `TECHNICIANS` queda solo como *fallback*. Resguardo: al editar una tarea con un técnico que ya no está en la lista, se conserva su nombre.

**(2) Backend:** `POST /tareas` valida que el técnico asignado sea un **técnico activo de la empresa** del creador (función `tecnicosDeEmpresa()`, dual Supabase/local). Si no, **400**.

### Verificación end-to-end
| Prueba | Resultado |
|---|---|
| `/auth/personal` como supervisor | ✅ lista usuarios reales |
| POST con técnico inexistente | ✅ 400 |
| POST con técnico válido | ✅ creada con `empresaId` correcto |
| Técnico intenta crear | ✅ 403 |
| Técnico ve sus tareas | ✅ solo las suyas |

---

## 4. Pendientes (deuda técnica)
- **`tecnicoId` estable**: hoy el vínculo tarea↔técnico es por nombre (frágil). Lo robusto es guardar el `usuario_id`.
- **Validación en `PUT /tareas`** al reasignar técnico (no se añadió para no romper edición de tareas legadas).
- **Inconsistencia de nombre**: perfil ("Paquito Ramon") vs usuario ("Tecnico Sur"). Unificar la fuente de `nombre`.
- **Supervisor** puede crear técnicos pero **no asignarles área** (`/auth/asignar-area` es solo admin+).
- **Doc `CLAUDE.md`** menciona `encargado_clientes` y 5 niveles; el código real tiene 4 roles.

---

## 5. Archivos tocados (commit `0a5d13e`)
- `server.js` — modificado (limpieza)
- `panel_tecnico.html` — modificado (tareas pendientes)
- `preventivo.html` — modificado (roles + dropdown real)
- `routes/preventivo.js` — modificado (roles + validación + scope)
- `selector.html` — **eliminado**
- `preview_monday.html` — **eliminado**

> 6 archivos, +126 / −1757 líneas. Push: `4515064..0a5d13e` → `gestion/main`.
