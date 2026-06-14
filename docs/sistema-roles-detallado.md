# Sistema de Roles — Especificación detallada

> Versión normalizada y tipada de las notas del equipo (14/06/2026).
> Complementa a [`especificaciones-sistema-roles.md`](./especificaciones-sistema-roles.md).
> Estado: **borrador para decisión**.

## 1. Visión del producto

Plataforma **multi-inquilino (multi-tenant SaaS)**. Nuestra empresa opera la plataforma
como **Super Admin**. Vendemos el acceso a **empresas clientes**, y cada una gestiona los
informes de **sus propios clientes finales** (a quienes les brindan servicios de
climatización, energía u obras civiles).

**Aislamiento:** cada empresa cliente debe tener su entorno **separado del de las demás**.
Una empresa nunca ve datos de otra. Solo el Super Admin tiene visión transversal.

---

## 2. Jerarquía de roles

```
Super Admin                      (plataforma — nuestra empresa)
└── Empresa (inquilino / tenant)
    ├── Admin                    (administra la empresa cliente)
    │   ├── Encargado de Clientes
    │   │   └── Supervisor
    │   │       └── Técnico
    │   ├── Supervisor
    │   └── Técnico
    └── Clientes finales         (entidades, no usuarios que inician sesión)
```

---

## 3. Roles y responsabilidades

### 3.1 Super Admin — *Control absoluto*
- Gestiona **todos** los usuarios de **todas** las empresas de la plataforma.
- Puede **leer y modificar** todas las opciones de cualquier usuario.
- **Filtrar / buscar** usuarios (por empresa, rol, estado, etc.).
- Visión transversal de todos los inquilinos; auditoría global.
- (Futuro) Gestión de suscripciones y alta/baja de empresas.

### 3.2 Admin (de empresa)
Administra su propia empresa (inquilino). Sus funciones:

**a) Crear Clientes finales** — ver entidad [Cliente](#41-cliente-final).

**b) Crear personal interno** — puede crear **Supervisores** y **Técnicos**
(y, según configuración, Encargados de Clientes). Ver entidad
[Personal interno](#42-personal-interno).

### 3.3 Encargado de Clientes
- Tiene **Supervisores asignados**.
- Puede ver las **métricas de sus clientes asignados**.

### 3.4 Supervisor
- **Asigna tareas** a los técnicos, asociadas a un **cliente**.
- **Carga** esas tareas a los técnicos.
- **Ve los informes** de esas tareas.
- **Aprueba** o **rechaza** los informes (control de calidad / QA).

### 3.5 Técnico
- **Agrega informes** a las tareas que tiene asignadas.
- Alternativamente, usa la plataforma para **crear informes individuales** (sin tarea previa).

---

## 4. Entidades clave

### 4.1 Cliente final
> Persona o empresa que contrata los servicios de la empresa-usuario para reparaciones,
> mantenimientos o instalaciones en las áreas de **Climatización, Energía y Obras civiles**.

| Campo | Tipo | Notas |
|-------|------|-------|
| Nombre del cliente | texto | requerido |
| RUT o DNI | texto | identificación fiscal/personal |
| Logo | imagen | opcional |
| Descripción de los trabajos solicitados | texto largo | |
| Áreas designadas | multi-selección | checklist al registrar: **Clima**, **Energía**, **OCC** (una, varias o todas) |

### 4.2 Personal interno
> Persona que pertenece a la empresa (inquilino) y tiene un rol dentro de ella.

| Campo | Tipo | Notas |
|-------|------|-------|
| Nombre | texto | requerido |
| RUT | texto | |
| Email | texto | login / notificaciones |
| Rol | selector | `Admin` · `Encargado de Clientes` · `Supervisor` · `Técnico` |
| Áreas de especialidad | multi-selección | **Clima**, **Energía**, **OCC** |

### 4.3 Tarea
> Trabajo asignado por un Supervisor a un Técnico, asociado a un Cliente.

| Campo | Tipo | Notas |
|-------|------|-------|
| Cliente | referencia | a quién corresponde la tarea |
| Técnico asignado | referencia | personal interno (rol Técnico) |
| Supervisor | referencia | quien la crea/asigna |
| Estado | enum | (a definir: pendiente / en curso / con informe / cerrada) |
| Informe(s) | relación | uno o varios informes cargados por el técnico |

### 4.4 Informe
> Documento técnico cargado por un Técnico; puede pertenecer a una tarea o ser individual.

| Campo | Tipo | Notas |
|-------|------|-------|
| Tarea | referencia | opcional (informe individual = sin tarea) |
| Técnico autor | referencia | |
| Área | enum | Clima / Energía / OCC |
| Estado | enum | `borrador` → `enviado` → `aprobado` / `rechazado` |
| Contenido / fotos | — | según plantilla (Tigo, WOM, etc.) |

---

## 5. Áreas de servicio (transversal)

Tres áreas, usadas como checklist en clientes, personal y tareas:

- **Clima** (climatización)
- **Energía**
- **OCC / OOCC** (Obras civiles)

> ⚠️ Unificar nomenclatura: en las notas aparece como `OCC` y en el doc original como
> `OOCC`. Elegir una.

---

## 6. Matriz de permisos (borrador)

| Acción | Super Admin | Admin | Encargado de Clientes | Supervisor | Técnico |
|--------|:-----------:|:-----:|:---------------------:|:----------:|:-------:|
| Ver/editar usuarios de TODAS las empresas | ✅ | — | — | — | — |
| Filtrar usuarios globalmente | ✅ | — | — | — | — |
| Crear/editar clientes finales | ✅ | ✅ | — | — | — |
| Crear personal interno (Supervisor/Técnico) | ✅ | ✅ | — | — | — |
| Asignar Supervisores a Encargados | ✅ | ✅ | — | — | — |
| Ver métricas de clientes asignados | ✅ | ✅ | ✅ | parcial | — |
| Asignar tareas a técnicos | ✅ | ✅ | — | ✅ | — |
| Crear informes | ✅ | ✅ | — | ✅ | ✅ |
| Aprobar / rechazar informes | ✅ | ✅ | — | ✅ | — |

*(Las celdas marcadas "parcial" o vacías están pendientes de confirmación.)*

---

## 7. Decisiones / dudas pendientes

- [ ] ¿El **Encargado de Clientes** puede crear personal, o solo supervisar?
- [ ] ¿Estados exactos de una **Tarea**?
- [ ] Nomenclatura de área: `OCC` vs `OOCC`.
- [ ] ¿"Informe individual" (sin tarea) requiere igualmente aprobación de un Supervisor?
- [ ] Mapeo de estos roles a los roles técnicos actuales del código
      (`superadmin`, `admin_empresa`, `supervisor`, `tecnico`) — falta el equivalente a
      **Encargado de Clientes**.
