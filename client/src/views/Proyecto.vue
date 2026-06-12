<template>
  <div class="page">
    <header id="mainHeader" :style="headerStyle">
      <div class="h-left">
        <router-link to="/dashboard" class="h-back">← Panel</router-link>
        <img v-if="proyecto?.logo" :src="proyecto.logo" class="h-logo" :alt="proyecto.nombre">
        <span class="h-name">{{ proyecto?.nombre || 'Cargando...' }}</span>
      </div>
      <span class="h-tpl">{{ proyecto?.template?.toUpperCase() || '—' }}</span>
    </header>

    <div v-if="proyecto" class="hero-wrap" :style="heroStyle">
      <div class="hero">
        <div class="hero-inner">
          <img v-if="proyecto.logo" :src="proyecto.logo" class="hero-logo" :alt="proyecto.nombre">
          <div class="hero-name">{{ proyecto.nombre }}</div>
          <div class="hero-sub">{{ proyecto.totalSitios }} sitios · {{ proyecto.totalTecnicos }} técnicos · {{ proyecto.totalSupervisores }} supervisores</div>
        </div>
      </div>
    </div>

    <div class="main" v-if="proyecto">
      <div class="section-card">
        <div class="sec-head">
          <div class="sec-title"><div class="icon">📊</div>Resumen del proyecto</div>
        </div>
        <div class="sec-body">
          <div class="info-grid">
            <div class="info-item"><div class="info-num">{{ proyecto.totalSitios }}</div><div class="info-label">Sitios</div></div>
            <div class="info-item"><div class="info-num">{{ proyecto.totalTecnicos }}</div><div class="info-label">Técnicos</div></div>
            <div class="info-item"><div class="info-num">{{ proyecto.totalSupervisores }}</div><div class="info-label">Supervisores</div></div>
          </div>
        </div>
      </div>

      <div class="section-card" v-if="proyecto.sitios?.length">
        <div class="sec-head"><div class="sec-title"><div class="icon">📍</div>Sitios</div></div>
        <div class="sec-body">
          <div class="list-tags">
            <span v-for="s in proyecto.sitios" :key="s.nombre || s" class="tag">{{ s.nombre || s }}</span>
          </div>
        </div>
      </div>

      <div class="section-card" v-if="proyecto.tecnicos?.length">
        <div class="sec-head"><div class="sec-title"><div class="icon">🔧</div>Técnicos</div></div>
        <div class="sec-body">
          <div class="list-tags">
            <span v-for="t in proyecto.tecnicos" :key="t" class="tag">{{ t }}</span>
          </div>
        </div>
      </div>

      <div class="section-card">
        <div class="sec-head"><div class="sec-title"><div class="icon">📄</div>Template</div></div>
        <div class="sec-body">
          <div class="tpl-info">
            <span :class="['badge', proyecto.template === 'tigo' ? 'badge-tigo' : 'badge-wom']">
              {{ proyecto.template?.toUpperCase() }}
            </span>
            <p>{{ proyecto.template === 'tigo' ? 'Informe de clima y equipos TIGO' : 'Informe de mantenimiento WOM' }}</p>
          </div>
        </div>
      </div>

      <button class="btn-nuevo-inf" :style="`background:${proyecto.color || '#323338'}`" @click="irAInforme">
        + Nuevo Informe
      </button>
    </div>

    <div v-if="!proyecto && !error" class="loading">Cargando proyecto...</div>
    <div v-if="error" class="error-page">{{ error }}</div>

    <div id="toast"></div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiGet } from '../api/client'

const route = useRoute()
const router = useRouter()
const proyecto = ref(null)
const error = ref('')

const headerStyle = computed(() => proyecto.value?.color
  ? `background: ${proyecto.value.color}`
  : 'background: #1C1F3B'
)
const heroStyle = computed(() => proyecto.value?.color
  ? `background: ${proyecto.value.color}`
  : 'background: linear-gradient(135deg, #1C1F3B, #2D3060)'
)

function irAInforme() {
  if (!proyecto.value) return
  router.push(proyecto.value.template === 'tigo' ? '/tigo' : '/wom')
}

function toast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg; el.className = 'show'
  clearTimeout(el._t); el._t = setTimeout(() => el.className = '', 2500)
}

onMounted(async () => {
  try {
    const data = await apiGet(`/api/proyectos/${route.params.slug}`)
    proyecto.value = data
  } catch (e) {
    error.value = 'Proyecto no encontrado.'
    toast('Error al cargar proyecto')
  }
})
</script>

<style scoped>
.page { font-family: 'Poppins', sans-serif; background: #F0F2F8; color: #323338; min-height: 100vh; }
header { padding: 13px 24px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; background: #1C1F3B; }
.h-left { display: flex; align-items: center; gap: 12px; }
.h-back { color: rgba(255,255,255,.5); font-size: 12px; font-weight: 500; text-decoration: none; border: 1px solid rgba(255,255,255,.18); padding: 5px 12px; border-radius: 7px; transition: .15s; }
.h-back:hover { background: rgba(255,255,255,.1); color: #fff; }
.h-logo { height: 32px; object-fit: contain; background: #fff; border-radius: 6px; padding: 3px 8px; }
.h-name { font-size: 15px; font-weight: 700; color: #fff; }
.h-tpl { font-size: 10px; font-weight: 600; padding: 3px 9px; border-radius: 10px; background: rgba(255,255,255,.1); color: rgba(255,255,255,.7); }
.hero-wrap { }
.hero { padding: 36px 24px 44px; text-align: center; }
.hero-inner { max-width: 600px; margin: 0 auto; }
.hero-logo { height: 70px; object-fit: contain; margin-bottom: 16px; }
.hero-name { font-size: 26px; font-weight: 800; color: #fff; margin-bottom: 8px; }
.hero-sub { font-size: 13px; color: rgba(255,255,255,.65); }
.main { max-width: 800px; margin: 0 auto; padding: 28px 16px 60px; }
.section-card { background: #fff; border-radius: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.05); border: 1px solid #E6E9EF; overflow: hidden; margin-bottom: 18px; }
.sec-head { padding: 18px 22px; border-bottom: 1px solid #F0F1F5; display: flex; align-items: center; }
.sec-title { font-size: 14px; font-weight: 700; color: #323338; display: flex; align-items: center; gap: 8px; }
.icon { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; }
.sec-body { padding: 22px; }
.info-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; }
.info-item { background: #F8F9FC; border-radius: 10px; padding: 14px 16px; }
.info-num { font-size: 26px; font-weight: 800; color: #323338; line-height: 1; }
.info-label { font-size: 11px; color: #676879; margin-top: 3px; }
.list-tags { display: flex; flex-wrap: wrap; gap: 8px; }
.tag { padding: 5px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; background: #F0F2F8; color: #323338; }
.tpl-info { display: flex; align-items: center; gap: 10px; padding: 14px 16px; background: #F8F9FC; border-radius: 10px; }
.badge { padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; }
.badge-tigo { background: #EEF5FF; color: #0073EA; }
.badge-wom  { background: #F3F0FF; color: #6161FF; }
.tpl-info p { font-size: 12px; color: #676879; }
.btn-nuevo-inf { width: 100%; max-width: 800px; margin: 0 auto 40px; padding: 16px; border-radius: 12px; border: none; font-size: 16px; font-weight: 800; cursor: pointer; color: #fff; display: flex; align-items: center; justify-content: center; gap: 10px; transition: .15s; }
.btn-nuevo-inf:hover { opacity: .88; transform: translateY(-1px); }
.loading { text-align: center; padding: 80px 20px; color: #676879; font-size: 14px; }
.error-page { text-align: center; padding: 80px 20px; color: #E2445C; font-size: 14px; }
@media (max-width: 520px) { .info-grid { grid-template-columns: 1fr 1fr; } }
</style>
