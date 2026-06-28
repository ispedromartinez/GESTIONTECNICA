// ── Cliente Supabase centralizado ──────────────────────────────
// Una única instancia para TODA la app (server.js + routers + capas db).
// Antes cada archivo hacía su propio createClient con criterios distintos:
// server.js ignoraba USE_LOCAL_DB y terminaba usando Supabase mientras el
// resto usaba SQLite local → almacenamiento partido ("split-brain").
//
// Regla única: usar Supabase solo si hay credenciales Y USE_LOCAL_DB != 'true'.
const { createClient } = require('@supabase/supabase-js');

const usandoSupabase = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_KEY &&
  process.env.USE_LOCAL_DB !== 'true'
);

const supabase = usandoSupabase
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  : null;

module.exports = { supabase, usandoSupabase };
