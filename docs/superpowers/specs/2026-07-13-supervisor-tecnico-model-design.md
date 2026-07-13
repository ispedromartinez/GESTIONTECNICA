# Modelo supervisor ↔ técnico y asignación de módulos

## Contexto

Hoy la relación jefe-técnico es una columna única `usuarios.supervisor_id`
(un solo supervisor por técnico) y la asignación de usuarios a módulos
(`asignaciones`) es solo para admin. Se necesita:

1. Un técnico puede estar a cargo de **varios** supervisores (muchos-a-muchos).
2. El **supervisor** (además del admin) puede dar a sus técnicos acceso a
   módulos.

## Modelo de datos

Tabla nueva `supervisor_tecnico`:

| col | tipo | nota |
|-----|------|------|
| id | uuid | pk |
| empresa_id | uuid | FK empresas, scope tenant |
| supervisor_id | uuid | FK usuarios (rol supervisor) |
| tecnico_id | uuid | FK usuarios (rol tecnico) |

`UNIQUE(supervisor_id, tecnico_id)`. Un técnico en varias filas = varios
supervisores. La columna vieja `usuarios.supervisor_id` se conserva por
compatibilidad (no se usa para esta lógica).

`asignaciones` (usuario↔proyecto) sigue siendo el mecanismo de acceso a
módulos; no cambia su forma.

## Reglas de negocio

- **Vínculo supervisor↔técnico:** lo crea/borra **solo el administrador**
  (admin_empresa/superadmin). El supervisor no elige sus técnicos.
- **Asignar técnico a un módulo:** lo puede hacer el **admin** (cualquiera a
  cualquier módulo de su empresa) o el **supervisor**, con candados:
  1. El supervisor debe estar asignado a ese módulo/proyecto.
  2. El técnico debe estar a cargo del supervisor (fila en `supervisor_tecnico`).
  3. El rol asignado se fuerza a `tecnico` (el supervisor no crea supervisores).
  4. Mismo `empresa_id` en todo.
- Granularidad: por módulo, uno por uno.
- **Visibilidad (ya implementada):** admin ve todos los módulos/proyectos de
  su empresa; supervisor y técnico solo los que tienen asignados.

## Backend

Helpers nuevos en `db/gestion.js`:
- `supervisorTecnicoAdd(empresa_id, supervisor_id, tecnico_id)`
- `supervisorTecnicoRemove(supervisor_id, tecnico_id)`
- `tecnicosDeSupervisor(supervisor_id)` → lista de técnicos a cargo
- `esTecnicoDe(supervisor_id, tecnico_id)` → bool (para el candado)

Endpoints en `routes/gestion.js`:
- `POST /api/gestion/supervisores/:id/tecnicos` (solo admin) — vincular.
- `DELETE /api/gestion/supervisores/:id/tecnicos/:tecnicoId` (solo admin).
- `GET /api/gestion/supervisores/:id/tecnicos` (admin) — listar vínculos.
- `GET /api/gestion/mis-tecnicos` (supervisor) — sus técnicos a cargo.
- Modificar `POST /proyectos/:id/asignaciones`: además de admin, permitir
  supervisor si cumple los 4 candados de arriba.

## Frontend

- **Admin** (`admin.html`): en el detalle de un usuario supervisor (o del
  usuario técnico), UI para vincular técnicos a ese supervisor.
- **Supervisor** (`dashboard.html` o su panel): ver sus técnicos a cargo y,
  por cada módulo que el supervisor tiene, un control para dar/quitar acceso
  a esos técnicos.

## Fuera de alcance

- Migrar los `supervisor_id` existentes al nuevo modelo (se reseteó la data).
- Que el supervisor cree o edite usuarios (sigue siendo admin+).
- La rama "admin no genera informes / supervisor sí" (pedido separado, se
  trata aparte).
