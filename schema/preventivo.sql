-- ════════════════════════════════════════════════════════════════
-- Tabla del módulo Mantenimiento Preventivo (gestión de tareas).
-- Ejecutar en el SQL Editor de Supabase SOLO si se usa Supabase como
-- almacenamiento. Si no, el módulo usa el archivo local
-- 'tareas_preventivo.json' automáticamente y no hace falta esto.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.tareas_preventivo (
  id                text primary key,
  descripcion       text,
  tecnico           text,
  fecha_inicio      text,
  fecha_vencimiento text,
  estado            text,
  sitio             text,
  destacada         boolean default false,
  tarea_numero      text,
  categoria         text,
  nombre_cliente    text,
  sala              text,
  nombre_empleado   text,
  crq_inc           text,
  numero_empleado   text,
  numero_cliente    text,
  n_workflow        text,
  n_lpu             text,
  comuna            text,
  recurrencia       text,
  notas             text,
  semana_iso        text,
  fecha_creacion    text,
  criticidad        text,
  categoria_sitio   text,
  direccion         text,
  ciudad            text,
  id_acceso         text,
  empresa_id        text,
  equipos           jsonb default '[]'::jsonb
);

create index if not exists tareas_preventivo_fecha_creacion_idx
  on public.tareas_preventivo (fecha_creacion desc);
create index if not exists tareas_preventivo_empresa_id_idx
  on public.tareas_preventivo (empresa_id);

-- El backend usa la service_role key (sin RLS) igual que el resto de
-- los módulos. Si activás RLS, recordá agregar políticas de
-- SELECT/INSERT/UPDATE/DELETE acordes.
