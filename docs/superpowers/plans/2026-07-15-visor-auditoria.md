# Visor de Auditoría — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar una vista "Auditoría" en `admin.html` que muestre el log de acciones (`GET /api/gestion/auditoria`) con tabla y filtros client-side, para `superadmin` y `admin_empresa`.

**Architecture:** Solo frontend en `admin.html` (SPA con `ITEMS`/`MENU`/`VIEWS`/`go()`). Se agrega un item de menú, una función de vista que hace un único fetch y guarda las filas en memoria, y filtros que re-renderizan sobre esas filas sin re-fetch. Backend y scoping por rol ya existen; no se tocan.

**Tech Stack:** HTML/JS vanilla, helpers `api()`/`sectionTable()`/`esc()`/`toast()` de `admin.html` + `common.js`.

## Global Constraints

- Cero cambios de backend. Endpoint `GET /api/gestion/auditoria` ya existe y hace el scoping por rol (`routes/gestion.js:15`).
- Todo dato del servidor renderizado en `innerHTML` DEBE pasar por `esc()` (regla XSS, `CLAUDE.md`). Dentro de `onclick="..."` usar `escArg()`.
- Seguir el patrón existente: `VIEWS.<id> = async () => {...}` que escribe en `$('content').innerHTML`; item en `ITEMS` + `MENU`.
- Rama de trabajo: `feat/visor-auditoria`. Servidor de verificación en modo local (`USE_LOCAL_DB=true`) en `localhost:3000`.
- Verificación es por navegador (no hay test runner para las páginas HTML).

---

### Task 1: Item de menú "Auditoría" + stub de vista

**Files:**
- Modify: `admin.html` (`ITEMS` ~L338-347, `MENU` ~L348-353, `VIEWS` ~L392+)

**Interfaces:**
- Produces: `ITEMS.auditoria`, entrada `'auditoria'` en `MENU.superadmin` y `MENU.admin_empresa`, y `VIEWS.auditoria` (async, sin args) que la Task 2 completa.

- [ ] **Step 1: Agregar `auditoria` a `ITEMS`**

Dentro del objeto `ITEMS` (después de la entrada `config`, antes del `};` de cierre en ~L346), agregar:

```js
  auditoria:    { ico:'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>', label:'Auditoría', sub:'Registro de acciones', grp:'Cuenta' },
```

- [ ] **Step 2: Agregar `'auditoria'` a los MENU de superadmin y admin_empresa**

Reemplazar las dos líneas en `MENU` (~L349-350) por:

```js
  superadmin:    ['empresas','proyectos','usuarios','asignaciones','auditoria','config'],
  admin_empresa: ['empresas','proyectos','usuarios','asignaciones','auditoria','config'],
```

- [ ] **Step 3: Agregar el stub de `VIEWS.auditoria`**

Justo después de `const VIEWS = {};` (~L392), agregar la variable de módulo y el stub:

```js
// ── Auditoría ──────────────────────────────────────────────────
let _auditRows = [];
VIEWS.auditoria = async () => {
  try {
    _auditRows = await api('/api/gestion/auditoria');
  } catch (e) {
    $('content').innerHTML = `<div class="section"><div class="empty-state">
      No se pudo cargar la auditoría: ${esc(e.message)}<br>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="go('auditoria')">Reintentar</button>
    </div></div>`;
    return;
  }
  // Task 2 reemplaza esta línea por renderAuditVista().
  $('content').innerHTML = `<div class="section"><div class="empty-state">${_auditRows.length} registros cargados</div></div>`;
};
```

- [ ] **Step 4: Verificar en navegador (superadmin)**

Arrancar server local y abrir sesión:

```bash
cd "C:/Users/Pedro Luis Martinez/Documents/InformesClima - servidor de prueba"
USE_LOCAL_DB=true node server.js &
```

En el navegador: login como superadmin → confirmar que aparece el ítem **Auditoría** en el sidebar (grupo "Cuenta") → click → se ve "N registros cargados" (N ≥ 0) y sin errores en consola.
Expected: ítem visible, vista carga, consola limpia.

- [ ] **Step 5: Verificar aislamiento (admin_empresa)**

Login como `admin_empresa` → confirmar que también ve el ítem Auditoría y que carga (solo registros de su empresa). Login como `tecnico` → confirmar que NO aparece el ítem.
Expected: admin_empresa ve el ítem; tecnico no.

- [ ] **Step 6: Commit**

```bash
git add admin.html
git commit -m "feat(auditoria): item de menu + carga de registros (stub)"
```

---

### Task 2: Tabla de auditoría (render, labels legibles, badges, detalle, estados)

**Files:**
- Modify: `admin.html` (nuevo `renderAuditVista()` y helpers; `<style>` para badges; reemplazo de la última línea del stub en `VIEWS.auditoria`)

**Interfaces:**
- Consumes: `_auditRows` (array de filas del backend), `sectionTable(...)`, `esc(...)`.
- Produces: `renderAuditVista()`, helpers `auditAccionLabel(row)`, `auditDetalle(row)`, `auditFechaFmt(iso)`, `auditBadgeClass(accion)`.

- [ ] **Step 1: Agregar estilos de badge**

Dentro del `<style>` de la página (al final, antes de `</style>`), agregar:

```css
.aud-badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;}
.aud-crear{background:#DCFCE7;color:#166534;}
.aud-borrar{background:#FEE2E2;color:#991B1B;}
.aud-vincular{background:#DBEAFE;color:#1E40AF;}
.aud-otro{background:#E5E7EB;color:#374151;}
.aud-det{color:#64748B;font-size:12px;max-width:340px;overflow-wrap:anywhere;}
```

- [ ] **Step 2: Agregar los helpers de formato**

Justo después de la definición de `let _auditRows = [];` (Task 1), agregar:

```js
const AUD_ACCION = { crear:'Creó', borrar:'Borró', vincular:'Vinculó', desvincular:'Desvinculó' };
const AUD_ENTIDAD = { empresa:'empresa', usuario:'usuario', proyecto:'proyecto', supervisor_tecnico:'técnico' };
function auditAccionLabel(r){
  const a = AUD_ACCION[r.accion] || r.accion;
  const e = AUD_ENTIDAD[r.entidad] || r.entidad;
  return `${a} ${e}`;
}
function auditBadgeClass(accion){
  if(accion==='crear') return 'aud-crear';
  if(accion==='borrar') return 'aud-borrar';
  if(accion==='vincular'||accion==='desvincular') return 'aud-vincular';
  return 'aud-otro';
}
function auditFechaFmt(iso){
  const d = new Date(iso);
  if(isNaN(d)) return esc(iso||'');
  return esc(d.toLocaleString('es-CL', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }));
}
function auditDetalle(r){
  if(!r.detalle) return '—';
  let obj; try { obj = JSON.parse(r.detalle); } catch { return esc(String(r.detalle)); }
  if(obj && typeof obj === 'object'){
    const parts = Object.entries(obj).map(([k,v]) => `${esc(k)}: ${esc(String(v))}`);
    return parts.join(' · ') || '—';
  }
  return esc(String(obj));
}
```

- [ ] **Step 3: Agregar `renderAuditVista()`**

Después de los helpers del Step 2, agregar:

```js
function renderAuditVista(){
  const rows = _auditRows.map(r => `<tr>
    <td>${auditFechaFmt(r.fecha)}</td>
    <td>${esc(r.usuario_email || '—')}</td>
    <td><span class="aud-badge ${auditBadgeClass(r.accion)}">${esc(auditAccionLabel(r))}</span></td>
    <td>${esc(r.entidad_id || '—')}</td>
    <td class="aud-det">${auditDetalle(r)}</td>
  </tr>`);
  $('content').innerHTML = sectionTable({
    name: 'Registro de auditoría',
    sub: `${_auditRows.length} acciones registradas`,
    head: ['Fecha', 'Usuario', 'Acción', 'ID entidad', 'Detalle'],
    rows,
    emptyIcon: '📋',
    emptyMsg: 'Sin registros de auditoría todavía.'
  });
}
```

- [ ] **Step 4: Conectar el stub a la vista real**

En `VIEWS.auditoria` (Task 1), reemplazar la línea:

```js
  $('content').innerHTML = `<div class="section"><div class="empty-state">${_auditRows.length} registros cargados</div></div>`;
```

por:

```js
  renderAuditVista();
```

- [ ] **Step 5: Verificar en navegador**

Con el server local corriendo y datos de auditoría presentes (crear/borrar/vincular reales; si no hay, generar unos creando/borrando un usuario de prueba desde el panel):
- Login superadmin → Auditoría → se ve la tabla con Fecha, Usuario, Acción (badge de color correcto: crear=verde, borrar=rojo, vincular=azul), ID entidad, Detalle.
- Verificar que un `detalle`/email con `<` o `'` se muestra escapado (no ejecuta): en consola, `_auditRows.push({fecha:new Date().toISOString(),usuario_email:"x<img src=x onerror=alert(1)>@y",accion:"crear",entidad:"usuario",entidad_id:"<b>",detalle:null}); renderAuditVista();` → el texto aparece literal, NO salta alert.
Expected: tabla correcta, badges por color, payload XSS inerte.

- [ ] **Step 6: Commit**

```bash
git add admin.html
git commit -m "feat(auditoria): tabla con acciones legibles, badges y detalle escapado"
```

---

### Task 3: Filtros client-side (acción, usuario, texto)

**Files:**
- Modify: `admin.html` (`renderAuditVista()` gana barra de filtros; nuevos `auditFiltrar()`, estado de filtros)

**Interfaces:**
- Consumes: `_auditRows`, `renderAuditVista()` (Task 2), `sectionTable(...)`, `esc(...)`.
- Produces: `auditFiltros` (objeto de estado), `auditAplicar()` (lee inputs → re-render), filas filtradas dentro de `renderAuditVista()`.

- [ ] **Step 1: Agregar el estado de filtros**

Junto a `let _auditRows = [];`, agregar:

```js
let auditFiltros = { accion:'', usuario:'', texto:'' };
```

- [ ] **Step 2: Función que aplica filtros sobre `_auditRows`**

Después de `renderAuditVista` (se redefine su cuerpo en Step 3), agregar el filtro:

```js
function auditFiltradas(){
  const f = auditFiltros;
  const u = f.usuario.trim().toLowerCase();
  const t = f.texto.trim().toLowerCase();
  return _auditRows.filter(r => {
    if(f.accion && r.accion !== f.accion) return false;
    if(u && !String(r.usuario_email||'').toLowerCase().includes(u)) return false;
    if(t){
      const hay = `${r.usuario_email||''} ${r.entidad||''} ${r.entidad_id||''} ${r.detalle||''}`.toLowerCase();
      if(!hay.includes(t)) return false;
    }
    return true;
  });
}
function auditAplicar(){
  auditFiltros.accion = $('audAccion').value;
  auditFiltros.usuario = $('audUsuario').value;
  auditFiltros.texto = $('audTexto').value;
  renderAuditVista();
}
```

- [ ] **Step 3: Reemplazar `renderAuditVista()` para incluir barra de filtros y usar filas filtradas**

Reemplazar la función `renderAuditVista()` completa por:

```js
function renderAuditVista(){
  const data = auditFiltradas();
  const accionesUnicas = [...new Set(_auditRows.map(r => r.accion))].sort();
  const opts = ['<option value="">Todas las acciones</option>']
    .concat(accionesUnicas.map(a => `<option value="${esc(a)}" ${auditFiltros.accion===a?'selected':''}>${esc(AUD_ACCION[a]||a)}</option>`))
    .join('');
  const tools = `
    <select id="audAccion" class="inp-sm" onchange="auditAplicar()">${opts}</select>
    <input id="audUsuario" class="inp-sm" placeholder="Filtrar por usuario" value="${esc(auditFiltros.usuario)}" oninput="auditAplicar()">
    <input id="audTexto" class="inp-sm" placeholder="Buscar…" value="${esc(auditFiltros.texto)}" oninput="auditAplicar()">`;
  const rows = data.map(r => `<tr>
    <td>${auditFechaFmt(r.fecha)}</td>
    <td>${esc(r.usuario_email || '—')}</td>
    <td><span class="aud-badge ${auditBadgeClass(r.accion)}">${esc(auditAccionLabel(r))}</span></td>
    <td>${esc(r.entidad_id || '—')}</td>
    <td class="aud-det">${auditDetalle(r)}</td>
  </tr>`);
  $('content').innerHTML = sectionTable({
    name: 'Registro de auditoría',
    sub: `${data.length} de ${_auditRows.length} acciones`,
    tools,
    head: ['Fecha', 'Usuario', 'Acción', 'ID entidad', 'Detalle'],
    rows,
    emptyIcon: '📋',
    emptyMsg: _auditRows.length ? 'Ningún registro coincide con los filtros.' : 'Sin registros de auditoría todavía.'
  });
  // Mantener foco tras re-render de inputs de texto
  const foco = document.activeElement && document.activeElement.id;
  if(foco==='audUsuario' || foco==='audTexto'){
    const el = $(foco); if(el){ el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }
}
```

- [ ] **Step 4: Confirmar clase de input**

Verificar que exista una clase `.inp-sm` en el `<style>` (buscar `inp-sm`). Si NO existe, agregar al `<style>`:

```css
.inp-sm{padding:6px 10px;border:1px solid var(--p-border);border-radius:8px;font-size:13px;background:var(--p-surface);color:inherit;}
```

Comando para chequear:

```bash
grep -c "inp-sm" "C:/Users/Pedro Luis Martinez/Documents/InformesClima - servidor de prueba/admin.html"
```

Expected: si 0, agregar la clase; si ≥1, ya existe.

- [ ] **Step 5: Verificar en navegador**

Login superadmin → Auditoría:
- Dropdown "Acción": elegir "Borró" → solo filas de borrar; contador "sub" baja a "X de N".
- Input usuario: escribir parte de un email → filtra; el foco no se pierde al tipear.
- Buscador: escribir texto que matchee entidad/detalle → filtra.
- Combinar acción + texto → AND correcto.
- Limpiar filtros → vuelven todas.
Expected: filtros combinables, contador correcto, foco estable, sin errores consola.

- [ ] **Step 6: Commit + push**

```bash
git add admin.html
git commit -m "feat(auditoria): filtros por accion, usuario y texto (client-side)"
git push origin feat/visor-auditoria
```

---

## Notas de verificación final

- Correr `npm audit` no aplica (sin cambios de deps).
- Confirmar en consola del navegador: cero errores JS en las 3 vistas de rol.
- El endpoint ya devuelve orden `fecha` desc; no se re-ordena en cliente.
- Si `_auditRows` está vacío (empresa nueva sin acciones), la tabla muestra el empty-state, no error.
