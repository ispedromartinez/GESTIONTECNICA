<template>
  <div class="page">
    <header>
      <div class="h-brand">
        <div class="h-gt">GT</div>
        <span class="h-title">Nuevo Proyecto</span>
      </div>
      <router-link to="/dashboard" class="h-back">← Volver</router-link>
    </header>

    <div class="wizard-wrap">
      <!-- STEPS -->
      <div class="steps">
        <div v-for="(s, i) in stepLabels" :key="i" :class="['step', step > i ? 'done' : step === i ? 'active' : '']">
          <div class="step-circle">{{ step > i ? '✓' : i + 1 }}</div>
          <div class="step-label">{{ s }}</div>
        </div>
      </div>

      <!-- PASO 0: INFO BÁSICA -->
      <div v-show="step === 0" class="card">
        <div class="card-title">Información básica</div>
        <p class="card-sub">Define el nombre, identificador y apariencia del proyecto.</p>
        <div class="field">
          <label>Nombre del proyecto</label>
          <input v-model="form.nombre" type="text" placeholder="Ej: Proyecto XYZ" @input="autoSlug">
          <div class="field-hint">Nombre visible en el sistema.</div>
        </div>
        <div class="field">
          <label>Identificador (slug)</label>
          <input v-model="form.slug" type="text" placeholder="proyecto-xyz" @input="slugDirty = true">
          <div class="slug-preview">URL: /proyecto/<strong>{{ form.slug || 'identificador' }}</strong></div>
        </div>
        <div class="row2">
          <div class="field">
            <label>Template</label>
            <div class="tpl-grid">
              <div :class="['tpl-card', form.template === 'tigo' && 'sel']" @click="form.template = 'tigo'">
                <input type="radio" value="tigo" v-model="form.template">
                <div class="tpl-name"><span class="tpl-badge tb-tigo">TIGO</span></div>
                <div class="tpl-desc">Informe de clima y equipos</div>
                <div class="tpl-check">✓</div>
              </div>
              <div :class="['tpl-card', form.template === 'wom' && 'sel']" @click="form.template = 'wom'">
                <input type="radio" value="wom" v-model="form.template">
                <div class="tpl-name"><span class="tpl-badge tb-wom">WOM</span></div>
                <div class="tpl-desc">Informe de mantenimiento WOM</div>
                <div class="tpl-check">✓</div>
              </div>
            </div>
          </div>
          <div class="field">
            <label>Color del proyecto</label>
            <div class="color-row">
              <input type="color" v-model="form.color">
              <input type="text" v-model="form.color" placeholder="#0073EA">
            </div>
          </div>
        </div>
        <div class="field">
          <label>Logo del proyecto <span style="font-weight:400;text-transform:none">(opcional)</span></label>
          <div :class="['logo-zone', logoPreview && 'has']" @click="logoInput?.click()">
            <input ref="logoInput" type="file" accept="image/*" style="display:none" @change="onLogo">
            <div v-if="!logoPreview">
              <div class="logo-ic">🖼️</div>
              <div class="logo-hint">Click para subir logo (PNG, JPG)</div>
            </div>
            <img v-else :src="logoPreview" class="logo-preview" alt="Logo">
            <button v-if="logoPreview" class="logo-clear" @click.stop="clearLogo">✕</button>
          </div>
        </div>
        <div v-if="step0Err" class="err-msg">{{ step0Err }}</div>
        <div class="step-actions">
          <button class="btn-next" @click="nextStep(0)">Continuar →</button>
        </div>
      </div>

      <!-- PASO 1: SITIOS Y PERSONAL -->
      <div v-show="step === 1" class="card">
        <div class="card-title">Sitios y personal</div>
        <p class="card-sub">Agrega los sitios de trabajo y el equipo del proyecto.</p>
        <div class="field">
          <label>Sitios</label>
          <div class="sitios-section">
            <div v-for="(s, i) in form.sitios" :key="i" class="sitio-row">
              <input v-model="s.nombre" type="text" placeholder="Nombre del sitio">
              <input v-model="s.direccion" type="text" placeholder="Dirección">
              <button class="btn-rm-row" @click="form.sitios.splice(i, 1)">✕</button>
            </div>
            <button class="btn-add-row" @click="form.sitios.push({ nombre: '', direccion: '' })">+ Agregar sitio</button>
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label>Técnicos</label>
            <div v-for="(t, i) in form.tecnicos" :key="i" class="sitio-row" style="grid-template-columns:1fr auto">
              <input v-model="form.tecnicos[i]" type="text" placeholder="Nombre del técnico">
              <button class="btn-rm-row" @click="form.tecnicos.splice(i, 1)">✕</button>
            </div>
            <button class="btn-add-row" @click="form.tecnicos.push('')">+ Técnico</button>
          </div>
          <div class="field">
            <label>Supervisores</label>
            <div v-for="(s, i) in form.supervisores" :key="i" class="sitio-row" style="grid-template-columns:1fr auto">
              <input v-model="form.supervisores[i]" type="text" placeholder="Nombre del supervisor">
              <button class="btn-rm-row" @click="form.supervisores.splice(i, 1)">✕</button>
            </div>
            <button class="btn-add-row" @click="form.supervisores.push('')">+ Supervisor</button>
          </div>
        </div>
        <div class="step-actions">
          <button class="btn-back" @click="step = 0">← Atrás</button>
          <button class="btn-next" @click="nextStep(1)">Continuar →</button>
        </div>
      </div>

      <!-- PASO 2: CONFIRMAR -->
      <div v-show="step === 2" class="card">
        <div class="card-title">Confirmar y crear</div>
        <p class="card-sub">Revisa los datos antes de crear el proyecto.</p>
        <div class="summary">
          <div class="summary-row"><span>Nombre</span><strong>{{ form.nombre }}</strong></div>
          <div class="summary-row"><span>Slug</span><code>{{ form.slug }}</code></div>
          <div class="summary-row"><span>Template</span><strong>{{ form.template.toUpperCase() }}</strong></div>
          <div class="summary-row"><span>Sitios</span><strong>{{ form.sitios.filter(s=>s.nombre).length }}</strong></div>
          <div class="summary-row"><span>Técnicos</span><strong>{{ form.tecnicos.filter(Boolean).length }}</strong></div>
          <div class="summary-row"><span>Supervisores</span><strong>{{ form.supervisores.filter(Boolean).length }}</strong></div>
        </div>
        <div v-if="apiErr" class="err-msg">{{ apiErr }}</div>
        <div class="step-actions">
          <button class="btn-back" @click="step = 1">← Atrás</button>
          <button class="btn-next" :disabled="creating" @click="crear">
            {{ creating ? 'Creando...' : '✓ Crear Proyecto' }}
          </button>
        </div>
      </div>
    </div>

    <div id="toast"></div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { apiPost } from '../api/client'

const router = useRouter()
const auth = useAuthStore()

const step = ref(0)
const stepLabels = ['Información básica', 'Sitios y personal', 'Confirmar']
const slugDirty = ref(false)
const step0Err = ref('')
const apiErr = ref('')
const creating = ref(false)
const logoInput = ref(null)
const logoPreview = ref('')
const logoBase64 = ref('')

const form = ref({
  nombre: '', slug: '', template: 'tigo', color: '#0073EA',
  sitios: [], tecnicos: [], supervisores: []
})

function autoSlug() {
  if (slugDirty.value) return
  form.value.slug = form.value.nombre
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function onLogo(e) {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = ev => { logoPreview.value = ev.target.result; logoBase64.value = ev.target.result }
  reader.readAsDataURL(file)
}

function clearLogo() {
  logoPreview.value = ''; logoBase64.value = ''
  if (logoInput.value) logoInput.value.value = ''
}

function nextStep(from) {
  if (from === 0) {
    step0Err.value = ''
    if (!form.value.nombre.trim()) { step0Err.value = 'El nombre es requerido.'; return }
    if (!form.value.slug.trim())   { step0Err.value = 'El identificador es requerido.'; return }
    if (!form.value.template)      { step0Err.value = 'Selecciona un template.'; return }
  }
  step.value = from + 1
}

async function crear() {
  apiErr.value = ''
  creating.value = true
  try {
    const body = {
      nombre: form.value.nombre, slug: form.value.slug,
      template: form.value.template, color: form.value.color,
      sitios: form.value.sitios.filter(s => s.nombre.trim()),
      tecnicos: form.value.tecnicos.filter(Boolean),
      supervisores: form.value.supervisores.filter(Boolean),
      logo: logoBase64.value || null
    }
    const res = await apiPost('/api/proyectos', body)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al crear proyecto')
    router.replace('/dashboard')
  } catch (e) { apiErr.value = e.message }
  finally { creating.value = false }
}
</script>

<style scoped>
.page { font-family: 'Poppins', sans-serif; background: #F0F2F8; color: #323338; min-height: 100vh; }
header { background: #1C1F3B; padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; }
.h-brand { display: flex; align-items: center; gap: 10px; }
.h-gt { width: 32px; height: 32px; background: linear-gradient(135deg,#0073EA,#6161FF); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; color: #fff; }
.h-title { font-size: 14px; font-weight: 700; color: #fff; }
.h-back { color: rgba(255,255,255,.55); font-size: 12px; font-weight: 500; text-decoration: none; border: 1px solid rgba(255,255,255,.2); padding: 6px 14px; border-radius: 7px; transition: .15s; }
.h-back:hover { background: rgba(255,255,255,.1); color: #fff; }
.wizard-wrap { max-width: 760px; margin: 32px auto; padding: 0 16px 60px; }
.steps { display: flex; align-items: center; margin-bottom: 32px; }
.step { display: flex; flex-direction: column; align-items: center; flex: 1; position: relative; }
.step:not(:last-child)::after { content: ''; position: absolute; top: 17px; left: calc(50% + 18px); right: calc(-50% + 18px); height: 2px; background: #D0D4E4; z-index: 0; }
.step.done:not(:last-child)::after, .step.active:not(:last-child)::after { background: #0073EA; }
.step-circle { width: 34px; height: 34px; border-radius: 50%; border: 2px solid #D0D4E4; background: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #9ba1b0; position: relative; z-index: 1; transition: .2s; }
.step.done .step-circle { background: #0073EA; border-color: #0073EA; color: #fff; }
.step.active .step-circle { border-color: #0073EA; color: #0073EA; box-shadow: 0 0 0 4px rgba(0,115,234,.15); }
.step-label { font-size: 10px; font-weight: 600; color: #9ba1b0; margin-top: 6px; text-align: center; white-space: nowrap; }
.step.active .step-label { color: #0073EA; }
.step.done .step-label { color: #323338; }
.card { background: #fff; border-radius: 16px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,.06); border: 1px solid #E6E9EF; }
.card-title { font-size: 18px; font-weight: 800; color: #1C1F3B; margin-bottom: 6px; }
.card-sub { font-size: 13px; color: #676879; margin-bottom: 28px; }
.field { margin-bottom: 18px; }
.field label { display: block; font-size: 11px; font-weight: 700; color: #676879; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 7px; }
.field input, .field select { width: 100%; border: 1.5px solid #E6E9EF; border-radius: 9px; padding: 10px 14px; font-size: 14px; color: #323338; outline: none; transition: .15s; background: #fff; }
.field input:focus { border-color: #0073EA; box-shadow: 0 0 0 3px rgba(0,115,234,.1); }
.field-hint { font-size: 11px; color: #9ba1b0; margin-top: 5px; }
.slug-preview { font-size: 12px; background: #F0F2F8; padding: 8px 12px; border-radius: 7px; margin-top: 6px; color: #676879; font-family: monospace; }
.slug-preview strong { color: #0073EA; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.color-row { display: flex; align-items: center; gap: 10px; }
.color-row input[type=color] { width: 44px; height: 36px; border: 1.5px solid #E6E9EF; border-radius: 8px; cursor: pointer; padding: 2px; background: #fff; }
.color-row input[type=text] { flex: 1; }
.tpl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.tpl-card { border: 2px solid #E6E9EF; border-radius: 12px; padding: 16px; cursor: pointer; transition: .15s; position: relative; }
.tpl-card:hover { border-color: #b3c8e8; background: #F8FAFF; }
.tpl-card.sel { border-color: #0073EA; background: #EEF5FF; }
.tpl-card input[type=radio] { position: absolute; opacity: 0; }
.tpl-name { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
.tpl-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; }
.tb-tigo { background: #EEF5FF; color: #0073EA; }
.tb-wom  { background: #F3F0FF; color: #6161FF; }
.tpl-desc { font-size: 12px; color: #676879; }
.tpl-check { position: absolute; top: 12px; right: 12px; width: 20px; height: 20px; border-radius: 50%; background: #0073EA; color: #fff; display: none; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }
.tpl-card.sel .tpl-check { display: flex; }
.logo-zone { border: 2px dashed #D0D4E4; border-radius: 12px; padding: 32px; text-align: center; cursor: pointer; transition: .15s; position: relative; background: #FAFBFC; }
.logo-zone:hover { border-color: #0073EA; background: #EEF5FF; }
.logo-zone.has { border-style: solid; border-color: #0073EA; background: #fff; }
.logo-ic { font-size: 36px; margin-bottom: 8px; }
.logo-hint { font-size: 12px; color: #9ba1b0; }
.logo-preview { max-height: 80px; max-width: 200px; object-fit: contain; margin: 0 auto; display: block; }
.logo-clear { position: absolute; top: 8px; right: 8px; background: #fef2f2; color: #E2445C; border: 1px solid #fca5a5; border-radius: 6px; padding: 3px 8px; font-size: 11px; font-weight: 700; cursor: pointer; z-index: 2; }
.sitios-section { display: flex; flex-direction: column; gap: 8px; }
.sitio-row { display: grid; grid-template-columns: 1fr 1.5fr auto; gap: 8px; align-items: center; }
.sitio-row input { border: 1.5px solid #E6E9EF; border-radius: 8px; padding: 9px 12px; font-size: 13px; color: #323338; outline: none; background: #fff; width: 100%; transition: .15s; }
.sitio-row input:focus { border-color: #0073EA; }
.btn-rm-row { background: #fef2f2; color: #E2445C; border: 1px solid #fca5a5; border-radius: 7px; width: 30px; height: 36px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
.btn-rm-row:hover { background: #fee2e2; }
.btn-add-row { background: #f0fdf4; color: #00A86B; border: 1px solid #bbf7d0; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 5px; width: fit-content; transition: .15s; }
.btn-add-row:hover { background: #dcfce7; }
.summary { background: #F8F9FC; border-radius: 10px; padding: 18px; margin-bottom: 20px; display: flex; flex-direction: column; gap: 10px; }
.summary-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: #676879; }
.summary-row strong { color: #323338; font-weight: 700; }
.summary-row code { background: #E6E9EF; padding: 2px 8px; border-radius: 5px; font-size: 12px; color: #0073EA; }
.err-msg { background: #fef2f2; border: 1px solid #fca5a5; color: #E2445C; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 14px; }
.step-actions { display: flex; gap: 10px; margin-top: 24px; justify-content: flex-end; }
.btn-back { padding: 11px 24px; border-radius: 9px; border: 1.5px solid #E6E9EF; background: #fff; font-size: 13px; font-weight: 600; cursor: pointer; color: #676879; transition: .15s; }
.btn-next { padding: 11px 28px; border-radius: 9px; border: none; background: #0073EA; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; transition: .15s; }
.btn-next:hover:not(:disabled) { background: #005bb5; }
.btn-next:disabled { opacity: .5; cursor: not-allowed; }
@media (max-width: 580px) { .row2 { grid-template-columns: 1fr; } .tpl-grid { grid-template-columns: 1fr; } }
</style>
