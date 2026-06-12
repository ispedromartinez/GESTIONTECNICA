<template>
  <div class="page">
    <header>
      <div class="hdr-left">
        <router-link to="/dashboard" class="back-btn">← Volver</router-link>
        <span class="hdr-title">Gestión de Personal</span>
      </div>
      <span class="hdr-user">{{ usuario?.nombre }}</span>
    </header>

    <div class="hero">
      <h1>Personal del sistema</h1>
      <p>Administra supervisores y técnicos de tu equipo</p>
      <div class="rol-badge" :class="rolBadgeClass">{{ rolLabel }}</div>
    </div>

    <main>
      <!-- SUPERVISORES -->
      <div class="section">
        <div class="sec-head">
          <div class="sec-title">
            <div class="sec-icon si-blue">👤</div>
            <div>
              <div class="sec-name">Supervisores</div>
              <div class="sec-count">{{ supervisores.length }} supervisor{{ supervisores.length !== 1 ? 'es' : '' }}</div>
            </div>
          </div>
          <button v-if="canAddSupervisor" class="btn-add blue" @click="openModal('supervisor')">+ Agregar</button>
        </div>
        <div class="person-list">
          <div v-if="!supervisores.length" class="empty-state"><div class="empty-icon">👥</div><p>No hay supervisores aún.</p></div>
          <div v-for="p in supervisores" :key="p.id" class="person-item">
            <div class="person-info">
              <div class="person-avatar av-blue">{{ initials(p.nombre) }}</div>
              <div>
                <div class="person-name">{{ p.nombre }}</div>
              </div>
            </div>
            <button v-if="isSuperadmin" class="btn-del" @click="pedirEliminar(p)">Eliminar</button>
          </div>
        </div>
      </div>

      <!-- TECNICOS -->
      <div class="section">
        <div class="sec-head">
          <div class="sec-title">
            <div class="sec-icon si-green">🔧</div>
            <div>
              <div class="sec-name">Técnicos</div>
              <div class="sec-count">{{ tecnicos.length }} técnico{{ tecnicos.length !== 1 ? 's' : '' }}</div>
            </div>
          </div>
          <button class="btn-add green" @click="openModal('tecnico')">+ Agregar</button>
        </div>
        <div class="person-list">
          <div v-if="!tecnicos.length" class="empty-state"><div class="empty-icon">🔧</div><p>No hay técnicos aún.</p></div>
          <div v-for="p in tecnicos" :key="p.id" class="person-item">
            <div class="person-info">
              <div class="person-avatar av-green">{{ initials(p.nombre) }}</div>
              <div>
                <div class="person-name">{{ p.nombre }}</div>
              </div>
            </div>
            <button v-if="isSuperadmin" class="btn-del" @click="pedirEliminar(p)">Eliminar</button>
          </div>
        </div>
      </div>
    </main>

    <!-- MODAL AGREGAR -->
    <div v-if="showModal" class="modal-bg" @click.self="showModal = false">
      <div class="modal">
        <h3>{{ modalRol === 'supervisor' ? 'Agregar Supervisor' : 'Agregar Técnico' }}</h3>
        <p class="modal-sub">Se creará una cuenta de acceso con rol {{ modalRol }}.</p>
        <div class="field"><label>Nombre completo</label><input v-model="form.nombre" type="text" placeholder="Juan Pérez"></div>
        <div class="field"><label>Correo electrónico</label><input v-model="form.email" type="email" placeholder="correo@dominio.com"></div>
        <div class="field"><label>Contraseña temporal</label><input v-model="form.pass" type="password" placeholder="Mínimo 6 caracteres"></div>
        <div v-if="modalErr" class="modal-err">{{ modalErr }}</div>
        <div class="modal-actions">
          <button class="btn-cancel" @click="showModal = false">Cancelar</button>
          <button class="btn-confirm" :disabled="creating" @click="crearUsuario">{{ creating ? 'Creando...' : 'Crear cuenta' }}</button>
        </div>
      </div>
    </div>

    <!-- CONFIRM ELIMINAR -->
    <div v-if="showConfirm" class="confirm-bg" @click.self="showConfirm = false">
      <div class="confirm-box">
        <h4>¿Eliminar usuario?</h4>
        <p>"{{ pendingDel?.nombre }}" será eliminado del sistema permanentemente.</p>
        <div class="confirm-actions">
          <button class="btn-no" @click="showConfirm = false">Cancelar</button>
          <button class="btn-yes-del" @click="confirmarEliminar">Sí, eliminar</button>
        </div>
      </div>
    </div>

    <div id="toast"></div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { apiGet, apiPost, apiDelete } from '../api/client'

const router = useRouter()
const auth = useAuthStore()
const usuario = computed(() => auth.usuario)

const supervisores = ref([])
const tecnicos = ref([])

const showModal = ref(false)
const modalRol = ref('tecnico')
const form = ref({ nombre: '', email: '', pass: '' })
const modalErr = ref('')
const creating = ref(false)

const showConfirm = ref(false)
const pendingDel = ref(null)

const isSuperadmin = computed(() => auth.usuario?.rol === 'superadmin')
const canAddSupervisor = computed(() => ['superadmin', 'admin_empresa'].includes(auth.usuario?.rol))

const rolLabel = computed(() => ({
  superadmin: 'Superadmin', admin_empresa: 'Administrador', supervisor: 'Supervisor'
}[auth.usuario?.rol] || auth.usuario?.rol || ''))

const rolBadgeClass = computed(() => ({
  superadmin: 'badge-superadmin', admin_empresa: 'badge-admin_empresa', supervisor: 'badge-supervisor'
}[auth.usuario?.rol] || ''))

function initials(nombre) {
  return nombre.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function toast(msg, type = 'ok') {
  const el = document.getElementById('toast')
  el.textContent = msg; el.className = 'show ' + type
  clearTimeout(el._t); el._t = setTimeout(() => el.className = '', 2500)
}

async function cargarPersonal() {
  try {
    const personal = await apiGet('/auth/personal')
    supervisores.value = personal.filter(p => p.rol === 'supervisor')
    tecnicos.value     = personal.filter(p => p.rol === 'tecnico')
  } catch { toast('Error al cargar personal', 'err') }
}

function openModal(rol) {
  modalRol.value = rol
  form.value = { nombre: '', email: '', pass: '' }
  modalErr.value = ''
  showModal.value = true
}

async function crearUsuario() {
  modalErr.value = ''
  if (!form.value.nombre || !form.value.email || !form.value.pass) {
    modalErr.value = 'Todos los campos son requeridos.'; return
  }
  if (form.value.pass.length < 6) {
    modalErr.value = 'La contraseña debe tener al menos 6 caracteres.'; return
  }
  creating.value = true
  try {
    const res = await apiPost('/auth/crear-usuario', {
      nombre: form.value.nombre, email: form.value.email,
      password: form.value.pass, rol: modalRol.value
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al crear usuario')
    showModal.value = false
    toast(`✓ ${modalRol.value === 'supervisor' ? 'Supervisor' : 'Técnico'} creado correctamente`)
    await cargarPersonal()
  } catch (e) { modalErr.value = e.message }
  finally { creating.value = false }
}

function pedirEliminar(p) {
  pendingDel.value = p
  showConfirm.value = true
}

async function confirmarEliminar() {
  if (!pendingDel.value) return
  const p = pendingDel.value
  showConfirm.value = false
  try {
    const res = await apiDelete(`/auth/usuarios/${p.id}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al eliminar')
    toast('Usuario eliminado')
    await cargarPersonal()
  } catch (e) { toast(e.message, 'err') }
}

onMounted(async () => {
  await auth.fetchMe()
  if (auth.usuario?.rol === 'tecnico') { router.replace('/selector'); return }
  await cargarPersonal()
})
</script>

<style scoped>
.page { font-family: 'Poppins', sans-serif; background: #F6F7FB; min-height: 100vh; }
header { background: #1C1F3B; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 2px 12px rgba(0,0,0,.25); }
.hdr-left { display: flex; align-items: center; gap: 12px; }
.back-btn { background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.15); color: #fff; border-radius: 8px; padding: 7px 14px; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; transition: .15s; }
.back-btn:hover { background: rgba(255,255,255,.18); }
.hdr-title { font-size: 15px; font-weight: 700; color: #fff; }
.hdr-user { font-size: 11px; color: rgba(255,255,255,.45); font-weight: 500; }
.hero { background: linear-gradient(135deg, #1C1F3B, #2D3060); padding: 32px 20px 40px; text-align: center; }
.hero h1 { font-size: 22px; font-weight: 800; color: #fff; margin-bottom: 6px; }
.hero p { font-size: 13px; color: rgba(255,255,255,.55); }
.rol-badge { display: inline-block; margin-top: 12px; padding: 4px 14px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; }
.badge-superadmin { background: rgba(255,180,0,.2); color: #ffd000; border: 1px solid rgba(255,210,0,.3); }
.badge-admin_empresa { background: rgba(0,115,234,.2); color: #5aafff; border: 1px solid rgba(0,115,234,.3); }
.badge-supervisor { background: rgba(0,200,117,.15); color: #00C875; border: 1px solid rgba(0,200,117,.25); }
main { max-width: 780px; margin: 0 auto; padding: 24px 16px 60px; }
.section { background: #fff; border-radius: 14px; box-shadow: 0 1px 4px rgba(0,0,0,.06); margin-bottom: 20px; overflow: hidden; }
.sec-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid #E6E9EF; }
.sec-title { display: flex; align-items: center; gap: 10px; }
.sec-icon { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 17px; }
.si-blue { background: #EEF5FF; }
.si-green { background: #EDFFF6; }
.sec-name { font-size: 15px; font-weight: 700; color: #323338; }
.sec-count { font-size: 11px; color: #676879; }
.btn-add { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 12px; font-weight: 700; display: flex; align-items: center; gap: 5px; transition: .15s; }
.btn-add.blue { background: #0073EA; color: #fff; }
.btn-add.green { background: #00C875; color: #fff; }
.btn-add:hover { opacity: .85; }
.person-list { padding: 8px 12px; }
.person-item { display: flex; align-items: center; justify-content: space-between; padding: 12px 8px; border-bottom: 1px solid #F0F1F5; gap: 12px; }
.person-item:last-child { border-bottom: none; }
.person-info { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
.person-avatar { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; }
.av-blue { background: #0073EA; }
.av-green { background: #00C875; }
.person-name { font-size: 13px; font-weight: 600; color: #323338; }
.btn-del { background: #fef2f2; color: #E2445C; border: 1px solid #fca5a5; border-radius: 6px; padding: 5px 10px; font-size: 11px; font-weight: 700; cursor: pointer; transition: .15s; }
.btn-del:hover { background: #fee2e2; }
.empty-state { padding: 32px; text-align: center; color: #676879; font-size: 13px; }
.empty-icon { font-size: 32px; margin-bottom: 8px; }
.field { margin-bottom: 14px; }
.field label { font-size: 12px; font-weight: 600; color: #676879; text-transform: uppercase; letter-spacing: .5px; display: block; margin-bottom: 6px; }
.field input { width: 100%; border: 1.5px solid #E6E9EF; border-radius: 8px; padding: 10px 13px; font-size: 14px; color: #323338; outline: none; transition: .15s; }
.field input:focus { border-color: #0073EA; box-shadow: 0 0 0 3px rgba(0,115,234,.1); }
.modal-bg { display: flex; position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 200; align-items: center; justify-content: center; padding: 20px; }
.modal { background: #fff; border-radius: 16px; width: 100%; max-width: 420px; box-shadow: 0 20px 60px rgba(0,0,0,.3); padding: 28px 24px; }
.modal h3 { font-size: 17px; font-weight: 800; color: #323338; margin-bottom: 6px; }
.modal-sub { font-size: 13px; color: #676879; margin-bottom: 22px; }
.modal-err { font-size: 12px; color: #E2445C; margin-bottom: 12px; }
.modal-actions { display: flex; gap: 10px; margin-top: 8px; }
.btn-cancel { flex: 1; padding: 11px; border-radius: 8px; border: 1.5px solid #E6E9EF; background: #fff; font-size: 13px; font-weight: 600; cursor: pointer; color: #676879; transition: .15s; }
.btn-confirm { flex: 2; padding: 11px; border-radius: 8px; border: none; font-size: 13px; font-weight: 700; cursor: pointer; color: #fff; background: #0073EA; transition: .15s; }
.btn-confirm:disabled { opacity: .5; cursor: not-allowed; }
.confirm-bg { display: flex; position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 300; align-items: center; justify-content: center; padding: 20px; }
.confirm-box { background: #fff; border-radius: 14px; max-width: 360px; width: 100%; padding: 24px; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
.confirm-box h4 { font-size: 16px; font-weight: 800; color: #323338; margin-bottom: 8px; }
.confirm-box p { font-size: 13px; color: #676879; margin-bottom: 20px; line-height: 1.6; }
.confirm-actions { display: flex; gap: 10px; }
.btn-no { flex: 1; padding: 10px; border-radius: 8px; border: 1.5px solid #E6E9EF; background: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-yes-del { flex: 2; padding: 10px; border-radius: 8px; border: none; background: #E2445C; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }
</style>
