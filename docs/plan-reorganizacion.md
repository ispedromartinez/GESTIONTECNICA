# Plan de reinicio organizado — Proyecto "GestiónTécnica"

> Documento de decisión. Borrador para revisar y acordar entre el equipo (2 personas).
> Estado: **propuesta — pendiente de decisiones marcadas con ⚠️**.

## Qué es el proyecto (conclusión)

Una plataforma **multi-empresa (SaaS)** para generar **informes de mantenimiento de
equipos de clima / energía / obras civiles** en sitios de telecom (Tigo, WOM) y otros
clientes. Tiene dos mitades naturales:

1. **Gestión de accesos** — empresas (inquilinos) → clientes → proyectos/tareas →
   usuarios con roles.
2. **Creación de informes** — formularios por plantilla, fotos, generación de Word,
   estados de aprobación.

Esas dos mitades son la división de trabajo propuesta.

---

## 1. Stack recomendado (utilidades)

| Capa | Recomendación | Por qué |
|------|--------------|---------|
| **Frontend** | Vue 3 + Vite + Vue Router + Pinia | Ya se empezó esta migración en la rama `Revision`. Es la dirección correcta. |
| **Estilos** | `theme.css` (tokens) + componentes propios | Ya existe un design system (Poppins, tokens). No meter una librería pesada. |
| **Backend** | Node.js + Express modular | Es lo que ya hay; mantenerlo dividido en `routes/` desde el día 1. |
| **Base de datos** | PostgreSQL (Supabase) como única fuente | ⚠️ Hoy hay **doble DB** (Supabase + SQLite `auth.db`). Elegir **una**. Recomendación: Supabase Postgres; SQLite solo opcional sin internet. |
| **Auth** | JWT propio + bcryptjs | Ya existe y da control fino sobre los roles. |
| **Storage de fotos** | Supabase Storage | Ya integrado. |
| **Generar Word** | librería `docx` (`lib/docx-*.js`) | Ya funciona; se rescata tal cual. |
| **Email (invitaciones)** | nodemailer | Ya está. |
| **Validación** | Zod | Validar payloads en el backend, evitar datos sucios. |
| **Calidad** | ESLint + Prettier + Vitest | Barato de configurar, evita peleas de estilo. |

**⚠️ Decisión clave:** ¿Postgres como única DB, o mantener fallback SQLite? Recomendación
fuerte: **una sola DB**. El código dual de hoy duplica cada query y es la mayor fuente de
desorden trabajando dos personas.

---

## 2. Estructura del repo (monorepo limpio)

```
/client                 # Vue 3 (vistas de A y de B)
  /src
    /views              # Login.vue, Admin.vue, Informe*.vue ...
    /components         # AppSidebar, etc. (compartido)
    /stores             # auth.js (Pinia)
    /api                # client.js (fetch base con token)
/server
  /routes               # auth.js, empresas.js, proyectos.js, informes.js ...
  /db                   # acceso a datos (un solo backend)
  /middleware           # auth.js, roles.js
  /lib                  # docx-clima.js, docx-wom.js
  /schema               # migraciones .sql versionadas
/shared
  roles.js              # constantes de roles + matriz de permisos (la usan AMBOS)
  contracts.md          # contrato de la API (la "frontera" entre A y B)
```

**Qué rescatar (no reescribir todo):** vistas Vue de `Revision`, `lib/docx-*.js`,
`schema/*.sql`, `theme.css`, lógica de `middleware/roles.js`. "Desde cero" = estructura y
disciplina nuevas, **no** tirar el código que ya funciona.

---

## 3. Regla de oro para 2 personas: definir el **contrato** primero

Para no bloquearse, se acuerda una **frontera estable** el primer día:

1. **Esquema de base de datos** (tablas: `usuarios`, `empresas`, `clientes`, `proyectos`,
   `asignaciones`, `informes`, `fotos`).
2. **Matriz de roles → permisos.**
3. **Contrato de la API** (endpoints + forma del JSON).

Con eso acordado, A y B trabajan contra la interfaz, no contra el código del otro.

**Contrato mínimo entre mitades:** A garantiza que cada request lleva
`req.user = { id, rol, empresa_id }` y un middleware `requireRol(...)`. B construye lo de
informes asumiendo que eso existe (con un stub temporal si A no terminó).

---

## 4. División de tareas

### Persona A — Sistema de Roles, Acceso y Gestión
**Backend**
- Login/JWT, registro por invitación, recuperación de contraseña.
- CRUD de `empresas`, `usuarios`, `clientes`, `proyectos`, `asignaciones`.
- Middleware `auth` (verifica token) y `roles` (`requireRol`).
- `/auth/me` (devuelve el `usuario` que consume B).

**Frontend**
- Vistas: `Login.vue`, `Admin.vue` (empresas/usuarios/clientes/proyectos/asignaciones),
  `Perfil.vue`.
- Store `auth.js` (Pinia) + guards de ruta (redirección por rol).
- `AppSidebar.vue` con menú dinámico por rol.

### Persona B — Sistema de Informes
**Backend**
- Modelo de `informes` + máquina de estados (`borrador → enviado → aprobado/rechazado`).
- Endpoints: listar por proyecto, crear, cambiar estado, subir fotos a Storage.
- Generación de Word (`lib/docx-clima.js`, `lib/docx-wom.js`).

**Frontend**
- Vistas: `Selector.vue`, `InformeClima.vue` (Tigo), `InformeWom.vue`, listado/`Dashboard.vue`.
- Formularios con sus campos, fotos reposicionables, preview.
- Botón "descargar Word" / generar documento.

### Juntos primero (Fase 0)
Schema SQL · matriz de permisos · contrato de API · `theme.css` · `api/client.js` base ·
layout/sidebar. **Nadie arranca su mitad hasta acordar esto.**

---

## 5. Cronograma sugerido

| Fase | A | B | Meta |
|------|---|---|------|
| 0 — Cimientos (juntos) | Schema + contrato + bootstrap | idem | Repo nuevo corriendo, DB migrada, login "hola mundo" |
| 1 — Núcleo (paralelo) | Auth real + CRUD usuarios/empresas | Modelo informes + formulario básico | Cada mitad funciona aislada |
| 2 — Integración | Roles aplicados a endpoints | Informes filtrados por permisos de A | Las dos mitades hablan |
| 3 — Pulido | Invitaciones por email, perfil | Fotos + generación Word + estados | Flujo end-to-end |

---

## 6. Convenciones

- **Rama base nueva:** `develop`. Nadie commitea directo ahí.
- **Ramas de feature:** `feat/roles-login`, `feat/informes-form`, etc. → PR a `develop`.
- **Commits:** estilo *conventional* (`feat:`, `fix:`, `refactor:`).
- **`.gitignore`:** `node_modules/`, `dist/`, `.env`, `*.db`. (Hoy `dist/` y `node_modules`
  están versionados — no debe pasar en el repo nuevo.)
- **`.env.example`** commiteado (sin secretos).

---

## 7. Pasos de arranque

```bash
# 1. Rama nueva desde un punto limpio
git switch -c develop

# 2. Estructura: /client , /server , /shared

# 3. Frontend
cd client && npm create vite@latest . -- --template vue
npm i vue-router pinia

# 4. Backend
cd ../server && npm init -y
npm i express jsonwebtoken bcryptjs @supabase/supabase-js docx nodemailer zod dotenv cors

# 5. Calidad (raíz)
npm i -D eslint prettier vitest
```

---

## Decisiones pendientes (para resolver)

- [ ] **¿Una sola base de datos (Postgres) o se mantiene SQLite de fallback?** (recomendado: una sola)
- [ ] ¿Se confirma la migración completa a Vue 3 + Vite?
- [ ] ¿Monorepo (`/client` + `/server`) o repos separados?
- [ ] Nombre y remoto del repositorio definitivo.
