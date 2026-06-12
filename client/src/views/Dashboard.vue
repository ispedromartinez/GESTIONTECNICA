<template>
  <div class="layout">
    <AppSidebar v-model="sidebarOpen" :active="currentView" :badge-total="badgeTotal" @show-informes="goInformes" @show-proyectos="currentView = 'proyectos'" />

    <div class="main">
      <!-- TOPBAR -->
      <div class="topbar">
        <div class="topbar-left">
          <button class="hamburger" @click="sidebarOpen = !sidebarOpen">☰</button>
          <span class="topbar-title">{{ viewTitle }}</span>
        </div>
        <div class="topbar-right">
          <div v-show="currentView === 'informes' && subview === 'listado'" class="search-wrap">
            <span class="search-icon">🔍</span>
            <input v-model="busqueda" type="text" placeholder="Buscar..." @input="buscar">
          </div>
          <div v-show="currentView === 'informes'" class="view-toggle">
            <button :class="['vt-btn', subview === 'dashboard' && 'active']" @click="subview = 'dashboard'">📊 Resumen</button>
            <button :class="['vt-btn', subview === 'listado' && 'active']" @click="subview = 'listado'">📋 Listado</button>
          </div>
        </div>
      </div>

      <!-- CONTENIDO -->
      <div class="content">
        <!-- VISTA PROYECTOS -->
        <div v-show="currentView === 'proyectos'">
          <div class="welcome-bar">
            <h1 id="welcomeMsg">Bienvenido</h1>
            <p>Selecciona un proyecto para ingresar al módulo de informes</p>
          </div>
          <div class="projects-grid">
            <a href="/tigo" class="proj-card proj-tigo">
              <div class="proj-top"></div>
              <div class="proj-inner">
                <div class="proj-icon"><img src="/assets/tigo-logo.png" alt="Tigo"></div>
                <span class="proj-name">Proyecto TIGO</span>
                <span class="proj-desc">Informes de mantenimiento<br>de equipos de clima</span>
              </div>
              <button class="proj-btn">Ingresar →</button>
            </a>
            <a href="/wom" class="proj-card proj-wom">
              <div class="proj-top"></div>
              <div class="proj-inner">
                <div class="proj-icon"><span class="wom-text">wom</span></div>
                <span class="proj-name">Proyecto WOM</span>
                <span class="proj-desc">Informes de mantenimiento<br>de equipos de clima</span>
              </div>
              <button class="proj-btn">Ingresar →</button>
            </a>
            <!-- Proyectos custom -->
            <template v-for="p in proyectos" :key="p.id">
              <a :href="`/proyecto/${p.slug}`" class="proj-card proj-custom" :style="`--proj-color:${p.color || '#323338'}`">
                <div class="proj-top"></div>
                <div class="proj-inner">
                  <div class="proj-icon">
                    <img v-if="p.logo" :src="p.logo" class="proj-logo-img" :alt="p.nombre">
                    <span v-else :style="`font-size:36px;font-weight:800;color:${p.color||'#323338'}`">{{ p.nombre.substring(0,2).toUpperCase() }}</span>
                  </div>
                  <span class="proj-name">{{ p.nombre }}</span>
                  <span class="proj-desc">{{ p.totalSitios }} sitios · {{ p.totalTecnicos }} técnicos<br>Formato {{ p.template === 'tigo' ? 'Tigo' : 'WOM' }}</span>
                </div>
                <button class="proj-btn">Ingresar →</button>
              </a>
            </template>
            <router-link v-if="isSuperadmin" to="/nuevo-proyecto" class="btn-new-proj">
              <div class="np-icon">＋</div>
              <div class="np-label">Nuevo Proyecto</div>
              <div class="np-sub">Crear cliente personalizado</div>
            </router-link>
          </div>
        </div>

        <!-- VISTA INFORMES -->
        <div v-show="currentView === 'informes'">
          <!-- STATS -->
          <div class="stats-row">
            <div class="stat-card">
              <div class="stat-num">{{ stats.totalMes }}</div>
              <div class="stat-label">Este mes</div>
              <div class="stat-bar bar-blue"></div>
            </div>
            <div class="stat-card">
              <div class="stat-num">{{ stats.total }}</div>
              <div class="stat-label">Total informes</div>
              <div class="stat-bar bar-orange"></div>
            </div>
            <div class="stat-card">
              <div class="stat-num">{{ stats.tecnicos }}</div>
              <div class="stat-label">Técnicos</div>
              <div class="stat-bar bar-green"></div>
            </div>
          </div>

          <!-- SUBVISTA DASHBOARD -->
          <div v-show="subview === 'dashboard'">
            <div class="charts-grid">
              <div class="chart-card">
                <div class="chart-head">
                  <span class="chart-title">Distribución</span>
                  <div class="chart-pills">
                    <span class="cpill tigo">TIGO <b id="pillTigo">—</b></span>
                    <span class="cpill wom">WOM <b id="pillWom">—</b></span>
                  </div>
                </div>
                <div class="chart-body donut-wrap">
                  <canvas ref="canvasDonut" id="chartDonut"></canvas>
                </div>
                <div class="chart-sub" id="chartDonutSub">—</div>
              </div>

              <div class="chart-card">
                <div class="chart-head">
                  <span class="chart-title">Últimos 6 meses</span>
                </div>
                <div class="chart-body">
                  <canvas ref="canvasBar" id="chartBar"></canvas>
                </div>
              </div>
            </div>

            <div class="chart-card chart-card-full" style="margin-top:18px">
              <div class="chart-head">
                <span class="chart-title">Informes por sitio</span>
                <span class="chart-sub-inline" id="chartSitiosSub">—</span>
              </div>
              <div class="chart-body sitios-wrap">
                <canvas ref="canvasSitios" id="chartSitios"></canvas>
              </div>
            </div>
          </div>

          <!-- SUBVISTA LISTADO -->
          <div v-show="subview === 'listado'">
            <div class="section-card">
              <div class="section-head">
                <span class="section-head-title">Todos los informes</span>
                <div class="filtros">
                  <button :class="['filtro-btn', filtro === 'todos' && 'active']" @click="setFiltro('todos')">Todos</button>
                  <button :class="['filtro-btn', filtro === 'TIGO' && 'active']" @click="setFiltro('TIGO')">TIGO</button>
                  <button :class="['filtro-btn', filtro === 'WOM' && 'active']" @click="setFiltro('WOM')">WOM</button>
                </div>
              </div>
              <div class="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Proyecto</th><th>Sitio</th><th>Técnico</th><th>Fecha</th><th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="!paginado.length">
                      <td colspan="5" class="empty-tbl"><div class="ei">🗂️</div><p>No hay informes para mostrar.</p></td>
                    </tr>
                    <tr v-for="r in paginado" :key="r.id">
                      <td><span :class="['pbadge', r.proyecto==='TIGO'?'pb-tigo':'pb-wom']">{{ r.proyecto }}</span></td>
                      <td class="td-sitio">{{ r.sitio }}</td>
                      <td class="td-tec">{{ r.tecnico }}</td>
                      <td class="td-fecha">{{ fmtFecha(r.fecha) }}</td>
                      <td><span class="estado-badge est-ok">Completado</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="pag">
                <span>{{ pagInfo }}</span>
                <div class="pag-btns">
                  <button class="pag-btn" :disabled="pagina === 1" @click="irPag(pagina - 1)">‹</button>
                  <template v-for="i in totalPags" :key="i">
                    <button v-if="showPagBtn(i)" :class="['pag-btn', i===pagina && 'cur']" @click="irPag(i)">{{ i }}</button>
                    <button v-else-if="i===pagina-3||i===pagina+3" class="pag-btn" disabled>…</button>
                  </template>
                  <button class="pag-btn" :disabled="pagina === totalPags" @click="irPag(pagina + 1)">›</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div id="toast"></div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { Chart, registerables } from 'chart.js'
import AppSidebar from '../components/AppSidebar.vue'
import { useAuthStore } from '../stores/auth'
import { apiGet } from '../api/client'

Chart.register(...registerables)

const auth = useAuthStore()
const sidebarOpen = ref(false)
const currentView = ref('proyectos')
const subview = ref('dashboard')

const proyectos = ref([])
const isSuperadmin = computed(() => auth.usuario?.rol === 'superadmin')

const todosInformes = ref([])
const stats = ref({ totalMes: 0, total: 0, tecnicos: 0 })
const filtro = ref('todos')
const busqueda = ref('')
const pagina = ref(1)
const POR_PAG = 20
const informesCargados = ref(false)
const badgeTotal = computed(() => stats.value.total || 0)

const canvasDonut = ref(null)
const canvasBar = ref(null)
const canvasSitios = ref(null)
let _chartDonut = null, _chartBar = null, _chartSitios = null

const viewTitle = computed(() =>
  currentView.value === 'informes' ? 'Panel de Control' : 'Proyectos'
)

const listaFiltrada = computed(() => {
  let list = todosInformes.value
  if (filtro.value !== 'todos') list = list.filter(r => r.proyecto === filtro.value)
  const q = busqueda.value.toLowerCase().trim()
  if (q) list = list.filter(r =>
    (r.sitio || '').toLowerCase().includes(q) ||
    (r.tecnico || '').toLowerCase().includes(q) ||
    (r.codInforme || '').toLowerCase().includes(q)
  )
  return list
})

const totalPags = computed(() => Math.ceil(listaFiltrada.value.length / POR_PAG) || 1)

const paginado = computed(() => {
  const p = Math.min(pagina.value, totalPags.value)
  return listaFiltrada.value.slice((p - 1) * POR_PAG, p * POR_PAG)
})

const pagInfo = computed(() => {
  const total = listaFiltrada.value.length
  if (!total) return 'Sin resultados'
  const p = pagina.value
  return `Mostrando ${(p-1)*POR_PAG+1}–${Math.min(p*POR_PAG,total)} de ${total}`
})

function showPagBtn(i) {
  return i === 1 || i === totalPags.value || (i >= pagina.value - 2 && i <= pagina.value + 2)
}

function fmtFecha(f) {
  if (!f) return '—'
  const [y, m, d] = f.split('-')
  return d ? `${d}/${m}/${y}` : f
}

function setFiltro(f) { filtro.value = f; pagina.value = 1 }
function buscar() { pagina.value = 1 }
function irPag(p) {
  if (p < 1 || p > totalPags.value) return
  pagina.value = p
}

function toast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg; el.className = 'show'
  clearTimeout(el._t); el._t = setTimeout(() => el.className = '', 2500)
}

async function goInformes() {
  currentView.value = 'informes'
  if (!informesCargados.value) await cargarInformes()
  await nextTick()
  renderCharts(todosInformes.value)
}

async function init() {
  try {
    await auth.fetchMe()
    if (auth.usuario) {
      document.getElementById('welcomeMsg').textContent = 'Bienvenido, ' + auth.usuario.nombre.split(' ')[0]
    }
    await cargarProyectosCustom()
  } catch (e) { toast('Error de sesión') }
}

async function cargarProyectosCustom() {
  try {
    const data = await apiGet('/api/proyectos')
    proyectos.value = data
  } catch { /* silencioso */ }
}

async function cargarInformes() {
  try {
    const data = await apiGet('/api/dashboard')
    todosInformes.value = data.informes
    stats.value = data.stats
    informesCargados.value = true
  } catch (e) { toast('Error al cargar informes') }
}

function renderCharts(data) {
  const tigoCount = data.filter(r => r.proyecto === 'TIGO').length
  const womCount  = data.filter(r => r.proyecto === 'WOM').length

  const pillTigo = document.getElementById('pillTigo')
  const pillWom  = document.getElementById('pillWom')
  const donutSub = document.getElementById('chartDonutSub')
  if (pillTigo) pillTigo.textContent = tigoCount
  if (pillWom)  pillWom.textContent  = womCount
  if (donutSub) donutSub.textContent = tigoCount + womCount > 0
    ? `${Math.round(tigoCount / (tigoCount + womCount) * 100)}% TIGO` : '—'

  const now = new Date()
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    return {
      label: d.toLocaleString('es', { month: 'short' }).replace('.', '') + ' ' + String(d.getFullYear()).slice(2),
      year: d.getFullYear(), month: d.getMonth()
    }
  })
  const count = (proj, m) => data.filter(r =>
    r.proyecto === proj && r.fecha &&
    new Date(r.fecha).getFullYear() === m.year &&
    new Date(r.fecha).getMonth() === m.month
  ).length
  const tigoByM = months.map(m => count('TIGO', m))
  const womByM  = months.map(m => count('WOM',  m))

  const baseFont = { family: "'Poppins', sans-serif", size: 11 }
  const gridColor = '#F0F1F5'

  if (_chartDonut) _chartDonut.destroy()
  _chartDonut = new Chart(canvasDonut.value, {
    type: 'doughnut',
    data: {
      labels: ['TIGO', 'WOM'],
      datasets: [{ data: [tigoCount, womCount], backgroundColor: ['#0073EA', '#6161FF'], borderWidth: 0, hoverOffset: 6 }]
    },
    options: {
      cutout: '72%', responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { font: baseFont, padding: 14, boxWidth: 10, boxHeight: 10 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} informes` } }
      }
    }
  })

  if (_chartBar) _chartBar.destroy()
  _chartBar = new Chart(canvasBar.value, {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: [
        { label: 'TIGO', data: tigoByM, backgroundColor: '#0073EA', borderRadius: 5, borderSkipped: false },
        { label: 'WOM',  data: womByM,  backgroundColor: '#6161FF', borderRadius: 5, borderSkipped: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { position: 'bottom', labels: { font: baseFont, padding: 14, boxWidth: 10, boxHeight: 10 } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: baseFont } },
        y: { beginAtZero: true, grid: { color: gridColor }, ticks: { font: baseFont, stepSize: 1 } }
      }
    }
  })

  const sitioMap = {}
  data.forEach(r => {
    if (!r.sitio || r.sitio === '—') return
    if (!sitioMap[r.sitio]) sitioMap[r.sitio] = { TIGO: 0, WOM: 0 }
    sitioMap[r.sitio][r.proyecto] = (sitioMap[r.sitio][r.proyecto] || 0) + 1
  })
  const sitios = Object.entries(sitioMap)
    .map(([nombre, v]) => ({ nombre, total: v.TIGO + v.WOM, tigo: v.TIGO, wom: v.WOM }))
    .sort((a, b) => b.total - a.total).slice(0, 15)

  const sitiosSub = document.getElementById('chartSitiosSub')
  if (sitiosSub) sitiosSub.textContent = sitios.length + ' sitio' + (sitios.length !== 1 ? 's' : '')

  const canvas = canvasSitios.value
  if (canvas) canvas.height = Math.max(200, sitios.length * 34)

  if (_chartSitios) _chartSitios.destroy()
  _chartSitios = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: sitios.map(s => s.nombre),
      datasets: [
        { label: 'TIGO', data: sitios.map(s => s.tigo), backgroundColor: '#0073EA', borderRadius: 4, borderSkipped: false },
        { label: 'WOM',  data: sitios.map(s => s.wom),  backgroundColor: '#6161FF', borderRadius: 4, borderSkipped: false }
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: baseFont, padding: 14, boxWidth: 10, boxHeight: 10 } },
        tooltip: { callbacks: { title: ctx => ctx[0].label, label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.x} informe${ctx.parsed.x !== 1 ? 's' : ''}` } }
      },
      scales: {
        x: { stacked: true, beginAtZero: true, grid: { color: gridColor }, ticks: { font: baseFont, stepSize: 1 } },
        y: { stacked: true, grid: { display: false }, ticks: { font: { ...baseFont, size: 11 } } }
      }
    }
  })
}

onMounted(init)
</script>

<style scoped>
.layout { display: flex; min-height: 100vh; }
.main { margin-left: 220px; flex: 1; display: flex; flex-direction: column; min-height: 100vh; }

.topbar {
  background: #fff; padding: 13px 26px;
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid #E6E9EF; position: sticky; top: 0; z-index: 50;
}
.topbar-left { display: flex; align-items: center; gap: 12px; }
.hamburger { display: none; background: none; border: none; cursor: pointer; padding: 6px; border-radius: 7px; color: #676879; font-size: 18px; }
.topbar-title { font-size: 15px; font-weight: 700; color: #323338; }
.topbar-right { display: flex; align-items: center; gap: 10px; }
.search-wrap { position: relative; display: flex; align-items: center; }
.search-wrap input {
  border: 1.5px solid #E6E9EF; border-radius: 8px; padding: 7px 12px 7px 32px;
  font-size: 13px; color: #323338; width: 190px; outline: none; background: #F6F7FB; transition: .15s;
}
.search-wrap input:focus { border-color: #0073EA; background: #fff; }
.search-icon { position: absolute; left: 10px; color: #9ba1b0; font-size: 13px; pointer-events: none; }
.view-toggle { display: flex; gap: 4px; }
.vt-btn { padding: 6px 13px; border-radius: 20px; border: 1.5px solid #E6E9EF; font-size: 12px; font-weight: 600; cursor: pointer; background: #fff; color: #676879; transition: .13s; }
.vt-btn.active { background: #0073EA; border-color: #0073EA; color: #fff; }

.content { padding: 26px; flex: 1; }

/* PROYECTOS */
.welcome-bar { margin-bottom: 26px; }
.welcome-bar h1 { font-size: 22px; font-weight: 800; color: #1C1F3B; margin-bottom: 4px; }
.welcome-bar p { font-size: 13px; color: #676879; }
.projects-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 18px; max-width: 860px; }
.proj-card {
  background: #fff; border-radius: 14px; padding: 0 0 24px;
  display: flex; flex-direction: column; align-items: center;
  box-shadow: 0 2px 8px rgba(0,0,0,.06); cursor: pointer; text-decoration: none;
  transition: transform .2s, box-shadow .2s; border: 1.5px solid #E8EAED; overflow: hidden;
}
.proj-card:hover { transform: translateY(-4px); box-shadow: 0 12px 36px rgba(0,0,0,.12); border-color: transparent; }
.proj-top { width: 100%; height: 5px; border-radius: 12px 12px 0 0; }
.proj-tigo .proj-top { background: linear-gradient(90deg, #0073EA, #1976D2); }
.proj-wom  .proj-top { background: linear-gradient(90deg, #6161FF, #7B1FA2); }
.proj-custom .proj-top { background: var(--proj-color, #323338); }
.proj-custom .proj-btn { background: var(--proj-color, #323338); color: #fff; }
.proj-inner { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 26px 24px 0; width: 100%; }
.proj-icon { height: 70px; display: flex; align-items: center; justify-content: center; }
.proj-icon img { max-height: 70px; max-width: 180px; object-fit: contain; }
.proj-logo-img { max-height: 60px; max-width: 160px; object-fit: contain; }
.wom-text { font-size: 52px; font-weight: 900; color: #7B1FA2; letter-spacing: -3px; line-height: 1; font-style: italic; }
.proj-name { font-size: 13px; font-weight: 700; color: #323338; letter-spacing: .2px; text-transform: uppercase; }
.proj-desc { font-size: 12px; color: #676879; text-align: center; line-height: 1.6; }
.proj-btn { width: calc(100% - 48px); margin: 14px 24px 0; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; border: none; cursor: pointer; transition: opacity .15s; }
.proj-tigo .proj-btn { background: #0073EA; color: #fff; }
.proj-wom  .proj-btn { background: #6161FF; color: #fff; }
.proj-btn:hover { opacity: .85; }
.btn-new-proj {
  background: #fff; border: 2px dashed #D0D4E4; border-radius: 14px; padding: 0 0 24px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  cursor: pointer; font-family: inherit; transition: .15s; min-height: 220px;
  color: #9ba1b0; text-decoration: none; gap: 10px;
}
.btn-new-proj:hover { border-color: #0073EA; background: #EEF5FF; color: #0073EA; }
.np-icon { font-size: 36px; }
.np-label { font-size: 13px; font-weight: 700; }
.np-sub { font-size: 11px; opacity: .7; }

/* STATS */
.stats-row { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; margin-bottom: 24px; }
.stat-card { background: #fff; border-radius: 12px; padding: 20px 22px; box-shadow: 0 1px 3px rgba(0,0,0,.05); border: 1px solid #E6E9EF; }
.stat-num { font-size: 30px; font-weight: 800; color: #323338; line-height: 1; margin-bottom: 4px; }
.stat-label { font-size: 12px; color: #676879; font-weight: 500; }
.stat-bar { height: 3px; border-radius: 2px; margin-top: 12px; }
.bar-blue   { background: linear-gradient(90deg, #0073EA, #5aafff); }
.bar-orange { background: linear-gradient(90deg, #FF8C00, #FFD060); }
.bar-green  { background: linear-gradient(90deg, #00C875, #00E096); }

/* CHARTS */
.charts-grid { display: grid; grid-template-columns: 1fr 1.6fr; gap: 18px; }
.chart-card { background: #fff; border-radius: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.05); border: 1px solid #E6E9EF; overflow: hidden; padding: 18px 20px; }
.chart-card-full { width: 100%; }
.chart-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.chart-title { font-size: 14px; font-weight: 700; color: #323338; }
.chart-pills { display: flex; gap: 6px; }
.cpill { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; }
.cpill.tigo { background: #EEF5FF; color: #0073EA; }
.cpill.wom  { background: #F3F0FF; color: #6161FF; }
.chart-body { width: 100%; }
.donut-wrap { max-width: 200px; margin: 0 auto; }
.sitios-wrap { overflow-x: hidden; }
.chart-sub { text-align: center; font-size: 12px; color: #676879; margin-top: 8px; }
.chart-sub-inline { font-size: 11px; color: #676879; }

/* TABLA */
.section-card { background: #fff; border-radius: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.05); border: 1px solid #E6E9EF; overflow: hidden; }
.section-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 22px; border-bottom: 1px solid #F0F1F5; flex-wrap: wrap; gap: 8px; }
.section-head-title { font-size: 14px; font-weight: 700; color: #323338; }
.filtros { display: flex; gap: 6px; }
.filtro-btn { padding: 5px 13px; border-radius: 20px; border: 1.5px solid #E6E9EF; font-size: 12px; font-weight: 600; cursor: pointer; background: #fff; color: #676879; transition: .13s; }
.filtro-btn.active { background: #0073EA; border-color: #0073EA; color: #fff; }
.tbl-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
thead tr { background: #F8F9FC; }
th { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .7px; color: #676879; padding: 10px 18px; text-align: left; border-bottom: 1px solid #F0F1F5; white-space: nowrap; }
td { font-size: 13px; color: #323338; padding: 12px 18px; border-bottom: 1px solid #F6F7FB; vertical-align: middle; }
tr:last-child td { border-bottom: none; }
tbody tr:hover { background: #F8FAFF; }
.pbadge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 10px; font-weight: 700; }
.pb-tigo { background: #EEF5FF; color: #0073EA; }
.pb-wom  { background: #F3F0FF; color: #6161FF; }
.estado-badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; }
.est-ok { background: #EDFFF6; color: #00A86B; }
.td-fecha { color: #676879; font-size: 12px; white-space: nowrap; }
.td-tec { font-weight: 500; }
.td-sitio { font-weight: 600; }
.empty-tbl { text-align: center; padding: 52px 20px; color: #676879; }
.ei { font-size: 38px; margin-bottom: 8px; }
.pag { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-top: 1px solid #F0F1F5; font-size: 12px; color: #676879; flex-wrap: wrap; gap: 8px; }
.pag-btns { display: flex; gap: 3px; }
.pag-btn { padding: 4px 10px; border-radius: 6px; border: 1.5px solid #E6E9EF; background: #fff; font-size: 12px; cursor: pointer; transition: .12s; }
.pag-btn:hover:not(:disabled) { border-color: #0073EA; color: #0073EA; }
.pag-btn:disabled { opacity: .4; cursor: not-allowed; }
.pag-btn.cur { background: #0073EA; border-color: #0073EA; color: #fff; }

@media (max-width: 768px) {
  .main { margin-left: 0; }
  .hamburger { display: flex; }
  .charts-grid { grid-template-columns: 1fr; }
  .stats-row { grid-template-columns: 1fr 1fr; }
}
</style>
