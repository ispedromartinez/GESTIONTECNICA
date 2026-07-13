# Adaptar proyecto a Render + Supabase

## Contexto

El proyecto (generador de informes Tigo/WOM + gestión + preventivo) corre hoy
en local con backends duales: JSON/SQLite locales cuando `SUPABASE_URL`/
`SUPABASE_KEY` no están seteados, Supabase cuando sí lo están. El código ya
implementa ambos caminos en cada capa de datos (`if (supabase) {...} else
{...}`). El objetivo es desplegar en Render usando Supabase como único
backend de datos en producción, sin reescribir la lógica dual — solo
activarla — y migrar los datos locales existentes.

## Alcance

1. Provisionar un proyecto Supabase nuevo (DB Postgres + Storage + Auth de
   usuarios de la app).
2. Preparar el repo para deploy nativo en Render (sin Docker).
3. Migrar datos locales existentes (informes, usuarios, tareas preventivo,
   archivos) a Supabase.
4. Verificar el flujo completo contra Supabase antes de deployar.

Fuera de alcance: cambios de UI/UX, nuevas features, dominio custom, plan
pago de Render (se documenta como upgrade opcional, no se contrata ahora).

## 1. Supabase — backend de datos

Todo pasa a Supabase: tablas Postgres para informes Tigo/WOM, usuarios,
empresas/áreas, tareas preventivo, equipos; bucket de Storage
`documentos-word` para los `.docx` generados y fotos.

Pasos:
- Crear proyecto en supabase.com.
- Ejecutar en el SQL editor, en orden: `schema/auth.sql`,
  `schema/extension.sql`, `schema/equipos.sql`, `schema/preventivo.sql`.
- Crear bucket `documentos-word` en Storage (privado, acceso vía service
  role key).
- No se toca código de la capa de datos: cada módulo ya decide su backend
  según si `supabase` (cliente) existe. Setear `SUPABASE_URL` +
  `SUPABASE_KEY` en el entorno basta para que todo el server — incluida
  auth de usuarios (`routes/auth.js`), que hoy cae a SQLite local si no hay
  Supabase — cambie de local a Supabase.

## 2. Deploy en Render

- Se elimina `Dockerfile`: la única razón de tenerlo (LibreOffice para
  convertir DOCX a PDF server-side) ya no aplica — el visor "Ver Informe"
  usa `docx-preview` en el navegador (commit "Reemplaza LibreOffice por
  docx-preview"), no hay ninguna referencia a `soffice`/LibreOffice en
  `server.js`.
- Render "Web Service", runtime Node nativo: build `npm install`, start
  `npm start`.
- Plan free tier (dueme tras 15 min de inactividad, primer request ~30s de
  cold start). Documentar como aceptado; upgrade a plan Starter ($7/mes,
  siempre activo) es un cambio de un clic en el dashboard si hace falta
  después.
- `app.set('trust proxy', 1)` ya está en `server.js` — requisito para que
  `express-rate-limit` no falle detrás del proxy de Render.

## 3. Variables de entorno

Se crea `.env.example` (commiteado, sin valores reales) documentando:

```
PORT=3000
JWT_SECRET=
SUPABASE_URL=
SUPABASE_KEY=
SUPABASE_BUCKET=documentos-word
ADMIN_SECRET=
```

`.env` real sigue local y gitignoreado (ya lo está). En Render, las mismas
vars se setean manualmente en Settings → Environment. `JWT_SECRET` se
genera nuevo (no reusar el de dev). `ADMIN_SECRET` se usa una sola vez
post-deploy para crear el primer superadmin vía
`POST /auth/register-superadmin`, luego puede rotarse/quitarse.

## 4. Migración de datos locales → Supabase

Script one-shot (`scripts/migrar-a-supabase.js`, no se commitea al repo
final del flujo normal de la app — es una herramienta de migración de un
solo uso, pero queda en el repo por si se repite en otro entorno) que:

- Lee `registro.json` y `registro_wom.json` → inserta en las tablas de
  informes Supabase usando los mismos mappers `fromX`/`toX` que ya usa el
  código de `server.js` para traducir camelCase → snake_case.
- Lee `auth.db` (SQLite) → inserta usuarios en la tabla de auth de
  Supabase (mismo hash de password, no se re-hashea).
- Lee `tareas_preventivo.json` → inserta en la tabla de preventivo usando
  el mapper `toTarea` de `routes/preventivo.js`.
- Sube cada archivo de `informes/` al bucket `documentos-word`.
- Corre contra el proyecto Supabase ya creado, usando la service role key
  desde `.env` local. Es idempotente por clave natural donde aplique
  (evita duplicar si se corre dos veces).

## 5. Verificación

Antes de deployar a Render:
- Setear `SUPABASE_URL`/`SUPABASE_KEY` en `.env` local, reiniciar server
  local apuntando a Supabase (no a JSON/SQLite).
- Confirmar: login con usuario migrado, generar un informe Tigo, generar
  un informe WOM, abrir "Ver Informe" (docx-preview) para ambos, confirmar
  que aparecen en el historial y que el archivo quedó en el bucket.

Después de deployar en Render:
- Repetir el mismo smoke test contra la URL pública de Render.

## Fuera de este spec

- Dominio custom.
- Plan pago de Render.
- Rotación/gestión de secretos más allá de setearlos una vez.
