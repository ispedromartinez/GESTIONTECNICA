<template>
  <div class="page">
    <div class="left-panel">
      <div class="form-wrap">
        <div class="logo-row">
          <img src="/assets/icetel-logo.png" alt="ICETEL" class="logo">
        </div>
        <h1>Iniciar sesión</h1>
        <p class="sub">Ingresa a tu cuenta para continuar</p>

        <form @submit.prevent="login">
          <div class="field">
            <label>Correo electrónico</label>
            <input v-model="email" type="email" placeholder="correo@empresa.com" autocomplete="email" required>
          </div>
          <div class="field">
            <label>Contraseña</label>
            <div class="pw-wrap">
              <input v-model="password" :type="showPw ? 'text' : 'password'" placeholder="••••••••" required>
              <button type="button" class="pw-eye" @click="showPw = !showPw">
                {{ showPw ? '🙈' : '👁️' }}
              </button>
            </div>
          </div>
          <div class="field">
            <label>Empresa <span class="opt">(opcional, solo superadmin)</span></label>
            <input v-model="empresa" type="text" placeholder="Nombre de la empresa">
          </div>

          <div class="remember-row">
            <label class="cb-label">
              <input v-model="remember" type="checkbox"> Recordarme
            </label>
          </div>

          <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

          <button type="submit" class="btn-login" :disabled="loading">
            {{ loading ? 'Ingresando...' : 'Ingresar' }}
          </button>
        </form>
      </div>
    </div>

    <div class="right-panel">
      <div class="right-inner">
        <div class="brand-logo">GT</div>
        <h2>GestiónTécnica</h2>
        <p>Sistema de gestión de informes técnicos para equipos de campo</p>
        <ul class="features">
          <li>✓ Informes TIGO y WOM</li>
          <li>✓ Generación de documentos DOCX</li>
          <li>✓ Control por roles y proyectos</li>
          <li>✓ Panel de estadísticas</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const empresa = ref('')
const remember = ref(false)
const showPw = ref(false)
const loading = ref(false)
const errorMsg = ref('')

async function login() {
  errorMsg.value = ''
  loading.value = true
  try {
    const body = { email: email.value, password: password.value }
    if (empresa.value.trim()) body.empresa = empresa.value.trim()

    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Credenciales incorrectas')

    auth.setToken(data.token, remember.value)
    auth.setUsuario(data.usuario)
    router.replace('/dashboard')
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.page { display: flex; min-height: 100vh; }

.left-panel {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 40px 24px; background: #fff;
}
.form-wrap { width: 100%; max-width: 380px; }
.logo-row { margin-bottom: 32px; }
.logo { height: 42px; object-fit: contain; }
h1 { font-size: 24px; font-weight: 800; color: #1C1F3B; margin-bottom: 6px; }
.sub { font-size: 13px; color: #676879; margin-bottom: 28px; }

.field { margin-bottom: 16px; }
.field label {
  display: block; font-size: 11px; font-weight: 700; color: #676879;
  text-transform: uppercase; letter-spacing: .5px; margin-bottom: 7px;
}
.opt { font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 10px; }
.field input {
  width: 100%; border: 1.5px solid #E6E9EF; border-radius: 9px;
  padding: 11px 14px; font-size: 14px; color: #323338; background: #fff;
  outline: none; transition: .15s;
}
.field input:focus { border-color: #0073EA; box-shadow: 0 0 0 3px rgba(0,115,234,.1); }
.pw-wrap { position: relative; }
.pw-wrap input { padding-right: 44px; }
.pw-eye {
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  background: none; border: none; font-size: 16px; cursor: pointer; padding: 4px;
}

.remember-row { margin-bottom: 20px; }
.cb-label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #676879; cursor: pointer; }

.error-msg {
  background: #fef2f2; border: 1px solid #fca5a5; color: #E2445C;
  padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 14px;
}

.btn-login {
  width: 100%; padding: 13px; border-radius: 9px; border: none;
  background: #0073EA; color: #fff; font-size: 14px; font-weight: 700;
  cursor: pointer; transition: .15s;
}
.btn-login:hover:not(:disabled) { background: #005bb5; }
.btn-login:disabled { opacity: .55; cursor: not-allowed; }

.right-panel {
  width: 400px; background: linear-gradient(135deg, #1C1F3B 0%, #2D3060 55%, #3B2070 100%);
  display: flex; align-items: center; justify-content: center; padding: 40px;
}
.right-inner { color: #fff; }
.brand-logo {
  width: 56px; height: 56px;
  background: linear-gradient(135deg, #0073EA, #6161FF);
  border-radius: 14px; display: flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 800; margin-bottom: 20px;
}
.right-inner h2 { font-size: 26px; font-weight: 800; margin-bottom: 10px; }
.right-inner p { font-size: 14px; color: rgba(255,255,255,.6); line-height: 1.7; margin-bottom: 24px; }
.features { list-style: none; display: flex; flex-direction: column; gap: 10px; }
.features li { font-size: 13px; color: rgba(255,255,255,.8); }

@media (max-width: 768px) { .right-panel { display: none; } }
</style>
