# Diseño: Recuperación de contraseña + Onboarding self-service

**Fecha:** 2026-07-02
**Estado:** Aprobado por Pedro
**Objetivo:** Convertir GestiónTécnica en SaaS con ciclo de cuenta autónomo: las empresas se registran solas (con aprobación del superadmin), los usuarios recuperan su contraseña sin intervención manual, y las cuentas trial tienen límites y vencimiento.

## Decisiones tomadas

| Decisión | Elección |
|----------|----------|
| Política de registro | Abierto con aprobación del superadmin (cuenta queda `pendiente` hasta aprobar) |
| Proveedor de email | Resend (API HTTP). En local/desarrollo sin `RESEND_API_KEY`: los correos se imprimen en consola |
| Trial | 30 días al aprobar; límites: 5 usuarios y 50 informes/mes. Al vencer: solo lectura |
| Activación pagada | Manual: superadmin cambia `estado=activa`. Pasarela de pago = fase futura, fuera de alcance |
| Backend de datos | Dual como toda la app: Supabase (producción) y SQLite/JSON local (`USE_LOCAL_DB=true`) para pruebas |

## Arquitectura

Se extiende el patrón existente: helpers duales `if (supabase) {...} else {...}`, rutas en `routes/auth.js` (o nuevo `routes/onboarding.js` si crece), páginas HTML vanilla en la raíz, rate limiting con `middleware/rateLimit.js`. Sin dependencias nuevas (Resend se llama con `fetch`).

### 1. Modelo de datos (ambos backends)

**`empresas`** — campos nuevos:
- `estado` TEXT: `pendiente` | `trial` | `activa` | `suspendida`. Empresas existentes migran a `activa`.
- `trial_hasta` DATE (null salvo en trial)
- `aprobada_por` (usuario_id del superadmin), `aprobada_en` (timestamp)

**`password_resets`** — tabla nueva:
- `id`, `usuario_id`, `token_hash` (sha256 del token; el token plano nunca se persiste), `expira_en` (creación + 1 h), `usado_en` (null hasta consumirse), `creado_en`

**`usuarios`** — campo nuevo:
- `debe_cambiar_password` BOOLEAN, default false. Se marca true al crear usuario con contraseña temporal (importación masiva XLSX, reenvío de invitación).

Migración: script SQL en `schema/` para Supabase + `ALTER TABLE` idempotente en `db/local.js` al arrancar (patrón ya usado por el proyecto).

### 2. Mailer — `services/mailer.js`

- `enviarCorreo({ to, subject, html })`:
  - Con `RESEND_API_KEY`: `POST https://api.resend.com/emails` con `from` = `MAIL_FROM` (env).
  - Sin la key: imprime a consola destinatario, asunto y cuerpo con el link clickeable — flujo completo probable en local sin enviar nada.
- Plantillas (funciones que devuelven HTML simple con la paleta del tema):
  - Reset de contraseña (link con token)
  - "Solicitud recibida" (al registrarse una empresa)
  - "Cuenta aprobada, ya puedes entrar"
- Env nuevas: `RESEND_API_KEY` (opcional), `MAIL_FROM` (default `GestiónTécnica <onboarding@resend.dev>`), `APP_URL` (base para links; default `http://localhost:3000`).

### 3. Recuperación de contraseña

- `POST /auth/olvide` (público, rate limit 3 intentos / 15 min por IP):
  1. Recibe `{ email }`.
  2. Si el usuario existe y está activo: genera token de 32 bytes aleatorios (`crypto.randomBytes`), guarda `sha256(token)` en `password_resets`, envía correo con link `${APP_URL}/restablecer?token=<token>`.
  3. **Respuesta idéntica exista o no el email** ("Si el correo está registrado, recibirás un enlace") — anti-enumeración.
- `POST /auth/restablecer` (público, rate limit): recibe `{ token, password }`.
  - Valida: hash del token existe, no usado, no expirado; contraseña ≥ 6 caracteres (regla actual del proyecto).
  - Actualiza `password_hash` (bcrypt 12), marca `usado_en`, limpia `debe_cambiar_password`.
  - Tokens de un solo uso; los demás tokens vivos del usuario se invalidan.
- Frontend: página `restablecer.html` (formulario token→contraseña nueva, lee token del query string) y activar el link "¿Olvidaste tu contraseña?" en `login.html` con un mini-formulario de email.

### 4. Onboarding con aprobación

- Página pública `registro.html`: nombre de empresa, RUT de empresa (validación de dígito verificador con `utils/rut.js`, unicidad), nombre / email / contraseña del administrador. Honeypot anti-bot + rate limit por IP.
- `POST /auth/registro-empresa` (público):
  1. Valida campos, RUT único, email único.
  2. Crea empresa con `estado=pendiente` (slug autogenerado desde el nombre, como en `routes/empresas.js`).
  3. Crea usuario `admin_empresa` con `activo=false`.
  4. Envía correo "solicitud recibida" al solicitante y aviso al superadmin (si `MAIL_ADMIN` está configurado).
- Login contra empresa `pendiente` o usuario inactivo → 403 "Tu cuenta está en revisión".
- Panel superadmin (`admin.html`):
  - Badge con conteo de solicitudes pendientes.
  - Lista de pendientes con datos de empresa y solicitante; botones **Aprobar** / **Rechazar**.
  - Aprobar → `estado=trial`, `trial_hasta = hoy + 30 días`, usuario activado, correo "cuenta aprobada".
  - Rechazar → elimina empresa y usuario (no se conservan, para no acumular tenants basura).
- Endpoints: `GET /api/empresas/pendientes`, `POST /api/empresas/:id/aprobar`, `POST /api/empresas/:id/rechazar` (todos `requireRol('superadmin')`).

### 5. Enforcement de estado y trial

- Helper `estadoEfectivo(empresa)`: `trial` con `trial_hasta` vencido → se comporta como `suspendida`.
- En **login**: empresa `pendiente` → 403 revisión; `suspendida`/trial vencido → login permitido, pero el token lleva `solo_lectura: true`.
- Middleware `bloquearEscrituraSuspendida`: aplicado a las rutas de negocio de escritura (generar informes, tareas, proyectos, usuarios). Si `solo_lectura` → 403 con mensaje "Tu período de prueba terminó. Contáctanos para activar tu cuenta." Los GET siguen funcionando (el cliente no pierde acceso a sus datos).
- Límites trial (solo cuando `estado=trial`):
  - Usuarios: al crear, si la empresa ya tiene 5 → error con mensaje de límite.
  - Informes: contador mensual por tenant (conteo de registros del mes en la tabla correspondiente); al llegar a 50 → error con mensaje de límite.
- Superadmin gestiona el estado desde el panel (activar como pagada, suspender, extender trial).

### 6. Cambio obligatorio de contraseña temporal

- Los flujos que generan contraseña temporal (importación XLSX, `POST /api/usuarios/:id/invitacion`) marcan `debe_cambiar_password=true`.
- Login con esa marca → el token incluye `debe_cambiar_password: true`; el frontend muestra un modal de cambio obligatorio en `login.html` (antes de redirigir al dashboard) y el backend solo acepta `POST /auth/cambiar-password` con ese token hasta completar el cambio.
- `POST /auth/cambiar-password`: contraseña actual + nueva → actualiza hash, limpia la marca, emite token normal.

### 7. Manejo de errores

- Todos los endpoints públicos: mensajes neutros que no revelan existencia de cuentas.
- Fallo de envío de correo: se loguea, la operación de negocio NO se revierte (el superadmin puede reenviar); en `/auth/olvide` el fallo de correo no cambia la respuesta al cliente.
- Tokens malformados/expirados: mensaje único "Enlace inválido o vencido. Solicita uno nuevo."

### 8. Pruebas (proyecto sin test runner — verificación manual)

En modo local (`USE_LOCAL_DB=true`, sin `RESEND_API_KEY`, correos a consola):
1. Registro de empresa → aparece pendiente en panel → login rechazado con mensaje de revisión.
2. Aprobar → correo (consola) → login OK → verificar `trial_hasta`.
3. Crear 6.º usuario en trial → error de límite. Generar informe 51 del mes → error de límite.
4. Vencer trial (ajustar fecha en BD) → login OK, GET OK, POST de negocio bloqueado.
5. `/auth/olvide` con email existente y no existente → misma respuesta; link de consola → restablecer → login con contraseña nueva; token reusado → rechazado.
6. Usuario con contraseña temporal → forzado a cambiarla antes de operar.
7. Rate limits: 4.º intento de `/auth/olvide` en 15 min → 429.

## Fuera de alcance (fases futuras)

- Pasarela de pago (Transbank / Mercado Pago / Stripe) y planes automáticos.
- Verificación de email por link al registrarse (la aprobación manual del superadmin cumple ese rol por ahora).
- 2FA, refresh tokens, notificaciones push.
