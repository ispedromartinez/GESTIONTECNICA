// ── Capa de datos dual para Perfiles/Proyectos/Asignaciones/Informes ──
// Misma estrategia que routes/auth.js: Supabase si está configurado y
// USE_LOCAL_DB != true; si no, SQLite local (db/local.js).
// Las columnas son idénticas en ambos motores (snake_case), no hay mapeo.

const local = require('./local');
const { supabase: supa } = require('./supabase');

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

  async proyectoDelete(id) {
    if (supa) {
      const { error } = await supa.from('proyectos').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }
    local.proyectos.delete(id);
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
      // Los proyectos ocultos no se muestran a supervisores/técnicos.
      return (data || [])
        .filter(r => r.proyectos && !r.proyectos.oculto)
        .map(r => ({ ...r.proyectos, rol_en_proyecto: r.rol_en_proyecto }));
    }
    return local.asignaciones.listByUsuario(usuario_id);
  },

  // ── ASIGNACIONES ────────────────────────────────────────────
  // Mapa usuario↔proyecto de una empresa (null = todas, solo superadmin)
  async asignacionesPorEmpresa(empresa_id) {
    if (supa) {
      let q = supa.from('asignaciones')
        .select('usuario_id, rol_en_proyecto, proyectos!inner(id,nombre,tipo,empresa_id)');
      if (empresa_id) q = q.eq('proyectos.empresa_id', empresa_id);
      const { data } = await q;
      return (data || []).map(r => ({
        usuario_id: r.usuario_id, proyecto_id: r.proyectos?.id,
        proyecto_nombre: r.proyectos?.nombre, proyecto_tipo: r.proyectos?.tipo,
        rol_en_proyecto: r.rol_en_proyecto
      }));
    }
    return local.asignaciones.listPorEmpresa(empresa_id);
  },

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
      const { error } = await supa.from('informes')
        .update({ estado, actualizado_en: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }
    local.informes.updateEstado(id, estado);
  },

  // Reasigna el técnico responsable: lo quita del anterior y lo pone en el nuevo.
  async informeUpdateTecnico(id, tecnico_id) {
    if (supa) {
      const { error } = await supa.from('informes')
        .update({ tecnico_id, actualizado_en: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }
    local.informes.updateTecnico(id, tecnico_id);
  },

  // Adjunta el documento generado y marca el informe como 'enviado' (generado).
  async informeSetDocumento(id, doc_url, doc_nombre) {
    if (supa) {
      const { error } = await supa.from('informes')
        .update({ estado: 'enviado', doc_url, doc_nombre, actualizado_en: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }
    local.informes.setDocumento(id, doc_url, doc_nombre);
  },

  // Informes del usuario (técnico o supervisor) — "Mis informes"
  async misInformes(usuario_id) {
    if (supa) {
      const { data } = await supa.from('informes')
        .select('*, proyectos(nombre,tipo,slug,template,color)')
        .or(`tecnico_id.eq.${usuario_id},supervisor_id.eq.${usuario_id}`)
        .order('fecha_creacion', { ascending: false });
      return (data || []).map(i => ({
        ...i,
        proyecto_nombre: i.proyectos?.nombre, proyecto_tipo: i.proyectos?.tipo,
        proyecto_slug: i.proyectos?.slug, proyecto_template: i.proyectos?.template,
        proyecto_color: i.proyectos?.color
      }));
    }
    return local.informes.listByUsuario(usuario_id);
  },

  // Informes recientes (dashboard); empresa_id opcional para acotar
  async informesRecientes(limit = 5, empresa_id = null) {
    if (supa) {
      let q = supa.from('informes').select('*, proyectos!inner(nombre,tipo,empresa_id)');
      if (empresa_id) q = q.eq('proyectos.empresa_id', empresa_id);
      const { data } = await q.order('fecha_creacion', { ascending: false }).limit(limit);
      return (data || []).map(i => ({ ...i, proyecto_nombre: i.proyectos?.nombre, proyecto_tipo: i.proyectos?.tipo }));
    }
    return local.informes.recientes(limit, empresa_id);
  },

  // Listado liviano de TODOS los informes para estadísticas del dashboard.
  // empresa_id opcional para acotar (admin_empresa); sin él, todos (superadmin).
  async informesParaStats(empresa_id = null) {
    if (supa) {
      let q = supa.from('informes').select('estado,fecha_creacion,sitio, proyectos!inner(nombre,tipo,empresa_id)');
      if (empresa_id) q = q.eq('proyectos.empresa_id', empresa_id);
      const { data } = await q;
      return (data || []).map(i => ({
        estado: i.estado, fecha_creacion: i.fecha_creacion, sitio: i.sitio,
        proyecto_nombre: i.proyectos?.nombre, proyecto_tipo: i.proyectos?.tipo
      }));
    }
    return local.informes.paraStats(empresa_id);
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
        .select('id,nombre,email,rol,empresa_id,supervisor_id,activo').single();
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

  // ── ÁREAS ───────────────────────────────────────────────────
  async areaById(id) {
    if (supa) {
      const { data } = await supa.from('areas').select('*').eq('id', id).single();
      return data || null;
    }
    return local.areas.findById(id) || null;
  },

  async areasByEmpresa(empresa_id) {
    if (supa) {
      const { data } = await supa.from('areas').select('*').eq('empresa_id', empresa_id).eq('activa', true);
      return data || [];
    }
    return local.areas.listByEmpresa(empresa_id);
  },

  async areaInsert(a) {
    if (supa) {
      const { data, error } = await supa.from('areas').insert(a).select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    return local.areas.insert(a);
  },

  async usuarioAreaUpsert(usuario_id, area_id, asignado_por) {
    if (supa) {
      const { error } = await supa.from('usuario_areas')
        .upsert({ usuario_id, area_id, asignado_por }, { onConflict: 'usuario_id,area_id' });
      if (error) throw new Error(error.message);
      return;
    }
    return local.usuario_areas.upsert(usuario_id, area_id, asignado_por);
  },

  // ── SUPERVISOR ↔ TÉCNICO (muchos-a-muchos) ──────────────────
  // Un técnico puede estar a cargo de varios supervisores. Solo el admin
  // crea/borra estos vínculos.
  async supervisorTecnicoAdd(empresa_id, supervisor_id, tecnico_id) {
    if (supa) {
      const { data, error } = await supa.from('supervisor_tecnico')
        .upsert({ empresa_id, supervisor_id, tecnico_id },
                { onConflict: 'supervisor_id,tecnico_id' })
        .select().single();
      if (error) throw new Error(error.message);
      return data;
    }
    return local.supervisor_tecnico.add(empresa_id, supervisor_id, tecnico_id);
  },

  async supervisorTecnicoRemove(supervisor_id, tecnico_id) {
    if (supa) {
      const { error } = await supa.from('supervisor_tecnico').delete()
        .eq('supervisor_id', supervisor_id).eq('tecnico_id', tecnico_id);
      if (error) throw new Error(error.message);
      return;
    }
    local.supervisor_tecnico.remove(supervisor_id, tecnico_id);
  },

  // Técnicos a cargo de un supervisor (usuarios activos, mismo tenant).
  async tecnicosDeSupervisor(supervisor_id) {
    if (supa) {
      const { data } = await supa.from('supervisor_tecnico')
        .select('tecnico_id, usuarios!supervisor_tecnico_tecnico_id_fkey(id,nombre,email,rol,activo)')
        .eq('supervisor_id', supervisor_id);
      return (data || [])
        .filter(r => r.usuarios && r.usuarios.activo)
        .map(r => ({ id: r.usuarios.id, nombre: r.usuarios.nombre, email: r.usuarios.email, rol: r.usuarios.rol }));
    }
    return local.supervisor_tecnico.tecnicosDe(supervisor_id);
  },

  async esTecnicoDe(supervisor_id, tecnico_id) {
    if (supa) {
      const { data } = await supa.from('supervisor_tecnico').select('id')
        .eq('supervisor_id', supervisor_id).eq('tecnico_id', tecnico_id).maybeSingle();
      return !!data;
    }
    return local.supervisor_tecnico.exists(supervisor_id, tecnico_id);
  },

  get usandoSupabase() { return !!supa; }
};

module.exports = db;
