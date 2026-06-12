<template>
  <aside class="sidebar" :class="{ open: modelValue }">
    <div class="sb-logo">
      <div class="sb-gt">GT</div>
      <div class="sb-brand">GestiónTécnica<span>ICETEL</span></div>
    </div>

    <nav class="sb-nav">
      <div class="sb-section">Menú</div>

      <button class="sb-item" :class="{ active: active === 'proyectos' }" @click="goProyectos">
        <span class="sb-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
        </span> Proyectos
      </button>

      <button class="sb-item" :class="{ active: active === 'informes' }" @click="goInformes">
        <span class="sb-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
        </span> Panel de Control
        <span v-if="badgeTotal" class="sb-badge">{{ badgeTotal }}</span>
      </button>

      <div class="sb-divider"></div>
      <div class="sb-section">Proyectos</div>

      <router-link to="/tigo" class="sb-item" @click="emit('update:modelValue', false)">
        <span class="sb-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
          </svg>
        </span> Nuevo – Tigo
      </router-link>

      <router-link to="/wom" class="sb-item" @click="emit('update:modelValue', false)">
        <span class="sb-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
          </svg>
        </span> Nuevo – WOM
      </router-link>

      <template v-if="canManagePersonal">
        <div class="sb-divider"></div>
        <router-link to="/admin" class="sb-item" @click="emit('update:modelValue', false)">
          <span class="sb-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </span> Personal
        </router-link>
      </template>
    </nav>

    <div class="sb-user">
      <div class="sb-avatar">{{ initials }}</div>
      <div class="sb-user-info">
        <div class="sb-user-name">{{ nombre }}</div>
        <div class="sb-user-rol">{{ rolLabel }}</div>
      </div>
      <button class="sb-logout" title="Cerrar sesión" @click="logout">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
      </button>
    </div>
  </aside>
  <div v-if="modelValue" class="overlay" @click="emit('update:modelValue', false)"></div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const props = defineProps({
  modelValue: Boolean,
  active: String,
  badgeTotal: Number
})
const emit = defineEmits(['update:modelValue', 'show-informes', 'show-proyectos'])

const auth = useAuthStore()
const router = useRouter()

const nombre = computed(() => auth.usuario?.nombre || '')
const initials = computed(() =>
  nombre.value.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '—'
)
const rolLabel = computed(() => ({
  superadmin: 'Superadmin',
  admin_empresa: 'Administrador',
  supervisor: 'Supervisor',
  tecnico: 'Técnico'
}[auth.usuario?.rol] || auth.usuario?.rol || ''))

const canManagePersonal = computed(() =>
  ['superadmin', 'admin_empresa', 'supervisor'].includes(auth.usuario?.rol)
)

function goInformes() {
  emit('update:modelValue', false)
  emit('show-informes')
}

function goProyectos() {
  emit('update:modelValue', false)
  router.push('/dashboard')
  emit('show-proyectos')
}

function logout() {
  auth.logout()
  router.replace('/login')
}
</script>

<style scoped>
.sidebar {
  width: 220px; min-width: 220px; background: #1C1F3B;
  display: flex; flex-direction: column; min-height: 100vh;
  position: fixed; top: 0; left: 0; bottom: 0; z-index: 100;
  transition: transform .25s ease;
}
.sb-logo {
  padding: 18px 18px 14px;
  display: flex; align-items: center; gap: 10px;
  border-bottom: 1px solid rgba(255,255,255,.07);
}
.sb-gt {
  width: 34px; height: 34px;
  background: linear-gradient(135deg, #0073EA, #6161FF);
  border-radius: 9px; display: flex; align-items: center;
  justify-content: center; font-size: 13px; font-weight: 800;
  color: #fff; flex-shrink: 0; letter-spacing: -.5px;
}
.sb-brand { font-size: 13px; font-weight: 700; color: #fff; line-height: 1.2; }
.sb-brand span { display: block; font-size: 10px; font-weight: 400; color: rgba(255,255,255,.35); margin-top: 1px; }
.sb-nav { flex: 1; padding: 10px 8px; overflow-y: auto; }
.sb-divider { height: 1px; background: rgba(255,255,255,.06); margin: 6px 8px; }
.sb-section {
  font-size: 9px; font-weight: 700; color: rgba(255,255,255,.28);
  text-transform: uppercase; letter-spacing: 1.2px; padding: 12px 10px 5px;
}
.sb-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 10px; border-radius: 8px; cursor: pointer;
  font-size: 13px; font-weight: 500; color: rgba(255,255,255,.55);
  transition: .13s; margin-bottom: 1px; text-decoration: none;
  border: none; background: none; width: 100%; font-family: inherit;
}
.sb-item:hover { background: rgba(255,255,255,.07); color: rgba(255,255,255,.9); }
.sb-item.active { background: rgba(0,115,234,.22); color: #fff; font-weight: 600; }
.sb-icon { opacity: .55; width: 16px; display: flex; align-items: center; justify-content: center; }
.sb-item.active .sb-icon { opacity: 1; }
.sb-badge {
  margin-left: auto; background: rgba(255,255,255,.12); color: rgba(255,255,255,.7);
  font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px; min-width: 22px; text-align: center;
}
.sb-user {
  padding: 12px 14px; border-top: 1px solid rgba(255,255,255,.07);
  display: flex; align-items: center; gap: 9px;
}
.sb-avatar {
  width: 32px; height: 32px; border-radius: 50%;
  background: linear-gradient(135deg, #0073EA, #6161FF);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: #fff; flex-shrink: 0;
}
.sb-user-info { flex: 1; min-width: 0; }
.sb-user-name { font-size: 12px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sb-user-rol { font-size: 10px; color: rgba(255,255,255,.38); margin-top: 1px; text-transform: capitalize; }
.sb-logout {
  background: none; border: none; color: rgba(255,255,255,.3);
  padding: 4px; border-radius: 6px; transition: .13s; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.sb-logout:hover { color: #fff; background: rgba(255,255,255,.1); }
.overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.4);
  z-index: 99; display: none;
}
@media (max-width: 768px) {
  .sidebar { transform: translateX(-100%); }
  .sidebar.open { transform: translateX(0); }
  .overlay { display: block; }
}
</style>
