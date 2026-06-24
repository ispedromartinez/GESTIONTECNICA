// ── Capa de datos dual para Perfiles/Proyectos/Asignaciones/Informes ──
// Misma estrategia que routes/auth.js: Supabase si está configurado y
// USE_LOCAL_DB != true; si no, SQLite local (db/local.js).
// Las columnas son idénticas en ambos motores (snake_case), no hay mapeo.

const local = require('./local');

let supa = null;
try {
  if (
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_KEY &&
    process.env.USE_LOCAL_DB !== 'true'
  ) {
    const { createClient } = require('@supabase/supabase-js');
    supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  }
} catch {}

const db = {
  // ── PERFILES ────────────────────────────────────────────────
  async perfilByUsuario(usuario_id) {
    if (supa) {
      const { data } = await supa.from('perfiles').select('*').eq('usuario_id', usuario_id).single();
      return data || null;
    }
    return local.perfiles.findByUsuario(usuario_id) || null;
  },

  // Regla 4: ¿el RUT ya existe en otro usuario?
  async perfilByRut(rut, exclude_usuario_id) {
    if (supa) {
      let q = supa.from('perfiles').select('usuario_id').eq('rut', rut);
      if (exclude_usuario_id) q = q.neq('usuario_id', exclude_usuario_id);
      const { data } = await q.maybeSingle();
      return data || null;
    }
    return local.perfiles.findByRut(rut, exclude_usuario_id) || null;
  },

  async perfilUpsert(p) {
    if (supa) {
      const { data, error } = await supa.from('perfiles')
        .upsert(p, { onConflict: 'usuario_id' }).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    return local.perfiles.upsert(p);
  },

  // ── PROYECTOS ───────────────────────────────────────────────
  async proyectoById(id) {
    if (supa) {
      const { data } = await supa.from('proyectos').select('*').eq('id', id).single();
      return data || null;
    }
    return local.proyectos.findById(id) || null;
  },

  // Regla 1: solo proyectos de la empresa indicada.
  async proyectosByEmpresa(empresa_id) {
    if (supa) {
      const { data } = await supa.from('proyectos')
        .select('*').eq('empresa_id', empresa_id).order('creado_en', { ascending: false });
      return data || [];
    }
    return local.proyectos.listByEmpresa(empresa_id);
  },

  async proyectoInsert(p) {
    if (supa) {
      const { data, error } = await supa.from('proyectos').insert(p).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    return local.proyectos.insert(p);
  },

  async proyectoUpdate(id, fields) {
    if (supa) {
      const { data, error } = await supa.from('proyectos').update(fields).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    return local.proyectos.update(id, fields);
  },

  // Todos los proyectos (solo superadmin)
  async proyectosAll() {
    if (supa) {
      const { data } = await supa.from('proyectos')
        .select('*, empresas(nombre)').order('creado_en', { ascending: false });
      return (data || []).map(p => ({ ...p, empresa_nombre: p.empresas?.nombre }));
    }
    return local.proyectos.all();
  },

  // Proyectos donde el usuario está asignado ("Mis proyectos")
  async misProyectos(usuario_id) {
    if (supa) {
      const { data } = await supa.from('asignaciones')
        .select('rol_en_proyecto, proyectos(*)').eq('usuario_id', usuario_id);
      return (data || []).map(r => ({ ...r.proyectos, rol_en_proyecto: r.rol_en_proyecto }));
    }
    return local.asignaciones.listByUsuario(usuario_id);
  },

  // ── ASIGNACIONES ────────────────────────────────────────────
  async asignacionExists(usuario_id, proyecto_id) {
    if (supa) {
      const { data } = await supa.from('asignaciones').select('id')
        .eq('usuario_id', usuario_id).eq('proyecto_id', proyecto_id).maybeSingle();
      return !!data;
    }
    return local.asignaciones.exists(usuario_id, proyecto_id);
  },

  async asignacionUpsert(usuario_id, proyecto_id, rol_en_proyecto) {
    if (supa) {
      const { data, error } = await supa.from('asignaciones')
        .upsert({ usuario_id, proyecto_id, rol_en_proyecto },
                { onConflict: 'usuario_id,proyecto_id' })
        .select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    return local.asignaciones.upsert(usuario_id, proyecto_id, rol_en_proyecto);
  },

  async asignacionRemove(usuario_id, proyecto_id) {
    if (supa) {
      const { error } = await supa.from('asignaciones').delete()
        .eq('usuario_id', usuario_id).eq('proyecto_id', proyecto_id);
      if (error) throw new Error(error.message);
      return;
    }
    local.asignaciones.remove(usuario_id, proyecto_id);
  },

  // Regla 2: técnicos/supervisores activos, de la empresa del proyecto,
  // asignados a ESE proyecto.
  async personalDeProyecto(proyecto_id, empresa_id) {
    if (supa) {
      const { data } = await supa.from('asignaciones')
        .select('rol_en_proyecto, usuarios!inner(id,nombre,rol,empresa_id,activo)')
        .eq('proyecto_id', proyecto_id)
        .eq('usuarios.empresa_id', empresa_id)
        .eq('usuarios.activo', true);
      return (data || [])
        .filter(r => ['supervisor', 'tecnico'].includes(r.usuarios.rol))
        .map(r => ({
          id: r.usuarios.id, nombre: r.usuarios.nombre,
          rol: r.usuarios.rol, rol_en_proyecto: r.rol_en_proyecto
        }));
    }
    return local.asignaciones.personalDeProyecto(proyecto_id, empresa_id);
  },

  // ── INFORMES ────────────────────────────────────────────────
  async informeById(id) {
    if (supa) {
      const { data } = await supa.from('informes').select('*').eq('id', id).single();
      return data || null;
    }
    return local.informes.findById(id) || null;
  },

  // Regla 3: SIEMPRE filtrado por proyecto_id.
  async informesByProyecto(proyecto_id) {
    if (supa) {
      const { data } = await supa.from('informes')
        .select('*').eq('proyecto_id', proyecto_id).order('fecha_creacion', { ascending: false });
      return data || [];
    }
    return local.informes.listByProyecto(proyecto_id);
  },

  async informeInsert(i) {
    if (supa) {
      const { data, error } = await supa.from('informes').insert(i).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    return local.informes.insert(i);
  },

  async informeUpdateEstado(id, estado) {
    if (supa) {
      const { error } = await supa.from('informes').update({ estado }).eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }
    local.informes.updateEstado(id, estado);
  },

  // Informes del usuario (técnico o supervisor) — "Mis informes"
  async misInformes(usuario_id) {
    if (supa) {
      const { data } = await supa.from('informes')
        .select('*, proyectos(nombre)')
        .or(`tecnico_id.eq.${usuario_id},supervisor_id.eq.${usuario_id}`)
        .order('fecha_creacion', { ascending: false });
      return (data || []).map(i => ({ ...i, proyecto_nombre: i.proyectos?.nombre }));
    }
    return local.informes.listByUsuario(usuario_id);
  },

  // Informes recientes (dashboard); empresa_id opcional para acotar
  async informesRecientes(limit = 5, empresa_id = null) {
    if (supa) {
      let q = supa.from('informes').select('*, proyectos!inner(nombre,empresa_id)');
      if (empresa_id) q = q.eq('proyectos.empresa_id', empresa_id);
      const { data } = await q.order('fecha_creacion', { ascending: false }).limit(limit);
      return (data || []).map(i => ({ ...i, proyecto_nombre: i.proyectos?.nombre }));
    }
    return local.informes.recientes(limit, empresa_id);
  },

  // ── Lectura de empresas/usuarios (misma BD) para el panel ──
  async empresasList() {
    if (supa) {
      const { data } = await supa.from('empresas').select('*').eq('activa', true);
      return data || [];
    }
    return local.empresas.list();
  },

  // Todas las empresas (incluye inactivas) — gestión de clientes
  async empresasListAll() {
    if (supa) {
      const { data } = await supa.from('empresas').select('*').order('creado_en', { ascending: false });
      return data || [];
    }
    return local.empresas.listAll();
  },

  async empresaById(id) {
    if (supa) {
      const { data } = await supa.from('empresas').select('*').eq('id', id).single();
      return data || null;
    }
    return local.empresas.findById(id) || null;
  },

  async empresaInsert(e) {
    if (supa) {
      const { data, error } = await supa.from('empresas').insert(e).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    return local.empresas.insert(e);
  },

  async empresaUpdate(id, fields) {
    if (supa) {
      const { data, error } = await supa.from('empresas').update(fields).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    return local.empresas.update(id, fields);
  },

  async usuariosList(empresa_id) {
    if (supa) {
      let q = supa.from('usuarios').select('id,nombre,email,rol,activo,empresa_id');
      if (empresa_id) q = q.eq('empresa_id', empresa_id);
      const { data } = await q;
      return data || [];
    }
    return local.usuarios.list(empresa_id);
  },

  async usuarioById(id) {
    if (supa) {
      const { data } = await supa.from('usuarios')
        .select('id,nombre,email,rol,activo,empresa_id').eq('id', id).single();
      return data || null;
    }
    return local.usuarios.findById(id) || null;
  },

  async usuarioInsert(u) {
    if (supa) {
      const { data, error } = await supa.from('usuarios').insert(u)
        .select('id,nombre,email,rol,empresa_id,activo').single();
      if (error) throw new Error(error.message);
      return data;
    }
    return local.usuarios.insert(u);
  },

  async usuarioUpdate(id, fields) {
    if (supa) {
      const { data, error } = await supa.from('usuarios').update(fields).eq('id', id)
        .select('id,nombre,email,rol,empresa_id,activo').single();
      if (error) throw new Error(error.message);
      return data;
    }
    return local.usuarios.update(id, fields);
  },

  get usandoSupabase() { return !!supa; }
};

module.exports = db;
