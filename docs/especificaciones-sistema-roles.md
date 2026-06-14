# Especificaciones Técnicas del Sistema de Roles y Usuarios

> Documento original aportado por el equipo (`documentos_md/especificaciones_sistema_roles.md`).
> Versión ampliada y normalizada en [`sistema-roles-detallado.md`](./sistema-roles-detallado.md).

## 1. Arquitectura Multi-Inquilino (Multi-tenant SaaS)
El sistema está diseñado con una separación estricta de planos:
- **Plano de Plataforma:** Administrado por el **Super Admin** (nuestra empresa).
- **Plano de Inquilino (Tenant):** Administrado por el **Admin de Empresa** (cada cliente que contrata el servicio).

---

## 2. Definición de Roles

### A. Plataforma (Nivel Super Admin)
- **Super Admin:** Control absoluto, gestión de suscripciones, visualización de todos los usuarios/inquilinos, auditoría global y suplantación de identidad para soporte técnico.

### B. Inquilino (Nivel Organización)
- **Empresa Admin:** Configuración corporativa, creación de personal interno y gestión de clientes finales.
- **Encargado de Clientes:** Supervisión de métricas y gestión de equipos operativos asignados.
- **Supervisor:** Gestión de tareas (creación/asignación), control de calidad (QA) de informes (aprobación/rechazo).
- **Técnico:** Ejecución de tareas de campo, creación y edición de informes técnicos.

---

## 3. Entidades Clave

### Cliente Final
- **Atributos:** Nombre, Rut/DNI, Logo, Descripción de trabajos, Dirección.
- **Áreas de Servicio:** Checkbox (Clima, Energía, OOCC).

### Personal Interno
- **Atributos:** Nombre, Rut, Email, Rol (selector), Áreas de especialidad (checkbox).

---

## 4. Flujo de Trabajo (Work-in-Progress)
1. El **Super Admin** crea el inquilino.
2. El **Admin** del inquilino crea su estructura (roles, áreas, clientes).
3. El **Supervisor** asigna tareas de campo al **Técnico**.
4. El **Técnico** carga el informe.
5. El **Supervisor** audita (Aprobar/Rechazar).

---

## 5. Tareas Pendientes para mañana
- [ ] Definir el esquema de base de datos para la relación `Tenant` <-> `User`.
- [ ] Diseñar el modelo de datos para `Informe Técnico`.
- [ ] Implementar la lógica de "Rechazo de Informe" con notificaciones.
- [ ] Revisar el sistema de permisos basado en roles (RBAC).
