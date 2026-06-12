<template>
  <div class="landing">
    <!-- NAVBAR -->
    <nav>
      <router-link to="/" class="nav-brand">
        <div class="nav-logo-box">GT</div>
        <span class="nav-brand-name">GestiónTécnica</span>
      </router-link>
      <div class="nav-links">
        <a href="#features" class="nav-link">Características</a>
        <a href="#how" class="nav-link">¿Cómo funciona?</a>
      </div>
      <div class="nav-right">
        <router-link to="/login" class="nav-login">Iniciar sesión</router-link>
        <a href="#contacto" class="nav-cta">Comenzar gratis</a>
      </div>
    </nav>

    <!-- HERO -->
    <section class="hero">
      <div class="hero-content">
        <div class="hero-badge">✦ Sistema de gestión profesional</div>
        <h1 class="hero-title">
          Gestiona tus informes técnicos<br>
          <span class="hero-gradient">sin complicaciones</span>
        </h1>
        <p class="hero-sub">
          Plataforma completa para equipos de campo: crea informes, gestiona sitios,
          genera documentos DOCX y controla todo desde un panel centralizado.
        </p>
        <div class="hero-actions">
          <router-link to="/login" class="btn-primary">Ingresar al sistema →</router-link>
          <a href="#features" class="btn-ghost">Ver características</a>
        </div>
      </div>
      <div class="hero-visual">
        <div class="hero-card">
          <div class="hc-header">
            <div class="hc-dot red"></div><div class="hc-dot yellow"></div><div class="hc-dot green"></div>
          </div>
          <div class="hc-body">
            <div class="hc-row"><div class="hc-badge tigo">TIGO</div><span>Informe #2026-001</span></div>
            <div class="hc-row"><div class="hc-badge wom">WOM</div><span>Informe #2026-042</span></div>
            <div class="hc-bar" style="width:85%"></div>
            <div class="hc-bar" style="width:60%"></div>
            <div class="hc-bar" style="width:72%"></div>
            <div class="hc-stat"><span>124</span><small>Informes este mes</small></div>
          </div>
        </div>
      </div>
    </section>

    <!-- STATS -->
    <section class="stats-section">
      <div class="stats-inner">
        <div class="stat-item"><div class="stat-num">+500</div><div class="stat-label">Informes generados</div></div>
        <div class="stat-item"><div class="stat-num">100+</div><div class="stat-label">Sitios gestionados</div></div>
        <div class="stat-item"><div class="stat-num">2</div><div class="stat-label">Clientes: TIGO & WOM</div></div>
        <div class="stat-item"><div class="stat-num">100%</div><div class="stat-label">Documentación DOCX</div></div>
      </div>
    </section>

    <!-- FEATURES -->
    <section id="features" class="features-section">
      <div class="section-inner">
        <div class="section-tag">Características</div>
        <h2>Todo lo que necesita tu equipo</h2>
        <p class="section-sub">Una plataforma diseñada para equipos técnicos que trabajan en campo</p>
        <div class="features-grid">
          <div class="feat-card">
            <div class="feat-icon">📄</div>
            <h3>Informes TIGO & WOM</h3>
            <p>Formularios especializados con todos los campos necesarios para informes técnicos de clima y mantenimiento.</p>
          </div>
          <div class="feat-card">
            <div class="feat-icon">📊</div>
            <h3>Panel de control</h3>
            <p>Dashboard con estadísticas, gráficas y listado de todos los informes generados por tu equipo.</p>
          </div>
          <div class="feat-card">
            <div class="feat-icon">📎</div>
            <h3>Generación DOCX</h3>
            <p>Genera documentos Word profesionales automáticamente con fotos, datos y firmas incluidas.</p>
          </div>
          <div class="feat-card">
            <div class="feat-icon">👥</div>
            <h3>Roles y permisos</h3>
            <p>Control de acceso por roles: superadmin, administrador, supervisor y técnico.</p>
          </div>
          <div class="feat-card">
            <div class="feat-icon">📍</div>
            <h3>Gestión de sitios</h3>
            <p>Base de datos de sitios con búsqueda inteligente y autocompletado para mayor velocidad.</p>
          </div>
          <div class="feat-card">
            <div class="feat-icon">🗂️</div>
            <h3>Historial y papelera</h3>
            <p>Accede a todos los informes anteriores, recupera borradores y gestiona el archivo.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- HOW IT WORKS -->
    <section id="how" class="how-section">
      <div class="section-inner">
        <div class="section-tag">¿Cómo funciona?</div>
        <h2>Tres pasos para tu informe</h2>
        <div class="steps-row">
          <div class="step-item">
            <div class="step-num">1</div>
            <h3>Completa el formulario</h3>
            <p>Ingresa los datos del sitio, equipo técnico y mediciones directamente desde el campo.</p>
          </div>
          <div class="step-arrow">→</div>
          <div class="step-item">
            <div class="step-num">2</div>
            <h3>Agrega fotos</h3>
            <p>Sube hasta 30 fotografías del trabajo realizado directamente desde el formulario.</p>
          </div>
          <div class="step-arrow">→</div>
          <div class="step-item">
            <div class="step-num">3</div>
            <h3>Genera el DOCX</h3>
            <p>Con un clic genera el informe completo en formato Word listo para enviar.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA CONTACTO -->
    <section id="contacto" class="cta-section">
      <div class="cta-inner">
        <h2>¿Listo para comenzar?</h2>
        <p>Contacta con nuestro equipo y configura la plataforma para tu empresa</p>
        <form class="contact-form" @submit.prevent="enviarContacto">
          <div class="cf-row">
            <input v-model="contacto.nombre" type="text" placeholder="Tu nombre" required>
            <input v-model="contacto.empresa" type="text" placeholder="Empresa">
          </div>
          <div class="cf-row">
            <input v-model="contacto.email" type="email" placeholder="Correo electrónico" required>
            <input v-model="contacto.tel" type="tel" placeholder="Teléfono (opcional)">
          </div>
          <textarea v-model="contacto.mensaje" placeholder="Cuéntanos sobre tu proyecto..." rows="3"></textarea>
          <div v-if="contactoOk" class="contact-ok">✓ Mensaje enviado correctamente. Te contactaremos pronto.</div>
          <div v-if="contactoErr" class="contact-err">{{ contactoErr }}</div>
          <button type="submit" class="btn-primary" :disabled="enviando">
            {{ enviando ? 'Enviando...' : 'Enviar mensaje' }}
          </button>
        </form>
      </div>
    </section>

    <!-- FOOTER -->
    <footer>
      <div class="footer-inner">
        <div class="footer-brand">
          <div class="nav-logo-box small">GT</div>
          <span>GestiónTécnica by ICETEL</span>
        </div>
        <span>© 2026 ICETEL — Todos los derechos reservados</span>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const contacto = ref({ nombre: '', empresa: '', email: '', tel: '', mensaje: '' })
const enviando = ref(false)
const contactoOk = ref(false)
const contactoErr = ref('')

async function enviarContacto() {
  enviando.value = true
  contactoErr.value = ''
  contactoOk.value = false
  try {
    const res = await fetch('/api/contacto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...contacto.value, fecha: new Date().toISOString() })
    })
    if (!res.ok) throw new Error('Error al enviar')
    contactoOk.value = true
    contacto.value = { nombre: '', empresa: '', email: '', tel: '', mensaje: '' }
  } catch (e) {
    contactoErr.value = 'No se pudo enviar el mensaje. Intenta de nuevo.'
  } finally {
    enviando.value = false
  }
}
</script>

<style scoped>
.landing { font-family: 'Poppins', system-ui, sans-serif; color: #323338; background: #fff; overflow-x: hidden; }

nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 200; height: 60px;
  display: flex; align-items: center; padding: 0 32px; background: #fff;
  border-bottom: 1px solid #E6E9EF; gap: 0;
}
.nav-brand { display: flex; align-items: center; gap: 8px; text-decoration: none; margin-right: 40px; flex-shrink: 0; }
.nav-logo-box {
  width: 32px; height: 32px; border-radius: 8px;
  background: linear-gradient(135deg, #6161FF, #0073EA);
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 900; color: #fff;
}
.nav-logo-box.small { width: 24px; height: 24px; font-size: 10px; }
.nav-brand-name { font-size: 15px; font-weight: 800; color: #323338; }
.nav-links { display: flex; align-items: center; gap: 4px; flex: 1; }
.nav-link { padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 500; color: #676879; text-decoration: none; transition: background .15s, color .15s; }
.nav-link:hover { background: #F6F7FB; color: #323338; }
.nav-right { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-shrink: 0; }
.nav-login { padding: 7px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; color: #676879; text-decoration: none; transition: background .15s, color .15s; }
.nav-login:hover { background: #F6F7FB; color: #323338; }
.nav-cta {
  padding: 8px 18px; border-radius: 6px;
  background: linear-gradient(135deg, #6161FF 0%, #0073EA 100%);
  font-size: 13px; font-weight: 700; color: #fff; text-decoration: none;
  box-shadow: 0 2px 8px rgba(97,97,255,.3); transition: opacity .15s, transform .1s;
}
.nav-cta:hover { opacity: .88; transform: translateY(-1px); }

.hero {
  margin-top: 60px;
  background: linear-gradient(160deg, #0F1035 0%, #1C1F4A 45%, #2D1B5A 100%);
  padding: 90px 32px 60px; display: flex; align-items: center; justify-content: center;
  gap: 60px; flex-wrap: wrap; min-height: 580px;
}
.hero-content { max-width: 520px; }
.hero-badge { display: inline-block; background: rgba(97,97,255,.25); color: #a78bfa; border: 1px solid rgba(97,97,255,.4); border-radius: 20px; padding: 6px 16px; font-size: 12px; font-weight: 700; margin-bottom: 24px; }
.hero-title { font-size: 44px; font-weight: 900; color: #fff; line-height: 1.15; margin-bottom: 20px; letter-spacing: -.5px; }
.hero-gradient { background: linear-gradient(90deg, #6161FF, #0073EA); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.hero-sub { font-size: 16px; color: rgba(255,255,255,.65); line-height: 1.7; margin-bottom: 32px; }
.hero-actions { display: flex; gap: 12px; flex-wrap: wrap; }
.btn-primary { display: inline-block; padding: 13px 28px; border-radius: 9px; background: linear-gradient(135deg, #6161FF, #0073EA); color: #fff; font-size: 14px; font-weight: 700; text-decoration: none; border: none; cursor: pointer; transition: opacity .15s, transform .1s; }
.btn-primary:hover { opacity: .88; transform: translateY(-1px); }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; transform: none; }
.btn-ghost { display: inline-block; padding: 13px 28px; border-radius: 9px; border: 1.5px solid rgba(255,255,255,.25); color: rgba(255,255,255,.8); font-size: 14px; font-weight: 600; text-decoration: none; transition: background .15s, border-color .15s; }
.btn-ghost:hover { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.4); }

.hero-visual { flex-shrink: 0; }
.hero-card { background: rgba(255,255,255,.06); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,.12); border-radius: 16px; padding: 0; overflow: hidden; width: 320px; }
.hc-header { background: rgba(255,255,255,.05); padding: 12px 16px; display: flex; gap: 6px; }
.hc-dot { width: 10px; height: 10px; border-radius: 50%; }
.hc-dot.red { background: #ff5f57; }
.hc-dot.yellow { background: #febc2e; }
.hc-dot.green { background: #28c840; }
.hc-body { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.hc-row { display: flex; align-items: center; gap: 10px; font-size: 12px; color: rgba(255,255,255,.7); }
.hc-badge { padding: 2px 9px; border-radius: 20px; font-size: 10px; font-weight: 700; }
.hc-badge.tigo { background: #EEF5FF; color: #0073EA; }
.hc-badge.wom  { background: #F3F0FF; color: #6161FF; }
.hc-bar { height: 6px; border-radius: 3px; background: linear-gradient(90deg, rgba(97,97,255,.5), rgba(0,115,234,.3)); }
.hc-stat { background: rgba(0,200,117,.1); border: 1px solid rgba(0,200,117,.2); border-radius: 10px; padding: 12px; }
.hc-stat span { font-size: 24px; font-weight: 900; color: #00C875; }
.hc-stat small { display: block; font-size: 11px; color: rgba(255,255,255,.5); margin-top: 2px; }

.stats-section { background: #1C1F3B; padding: 36px 32px; }
.stats-inner { max-width: 900px; margin: 0 auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
.stat-item { text-align: center; }
.stat-num { font-size: 32px; font-weight: 900; color: #fff; }
.stat-label { font-size: 12px; color: rgba(255,255,255,.5); margin-top: 4px; }

.section-inner { max-width: 900px; margin: 0 auto; text-align: center; }
.section-tag { display: inline-block; background: #EEF5FF; color: #0073EA; border-radius: 20px; padding: 5px 16px; font-size: 12px; font-weight: 700; margin-bottom: 16px; }
.section-inner h2 { font-size: 36px; font-weight: 900; color: #1C1F3B; margin-bottom: 12px; letter-spacing: -.3px; }
.section-sub { font-size: 15px; color: #676879; margin-bottom: 48px; line-height: 1.7; }

.features-section { padding: 80px 32px; background: #F6F7FB; }
.features-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; text-align: left; }
.feat-card { background: #fff; border-radius: 16px; padding: 28px; border: 1px solid #E6E9EF; box-shadow: 0 2px 8px rgba(0,0,0,.04); transition: transform .2s, box-shadow .2s; }
.feat-card:hover { transform: translateY(-4px); box-shadow: 0 12px 32px rgba(0,0,0,.1); }
.feat-icon { font-size: 28px; margin-bottom: 14px; }
.feat-card h3 { font-size: 15px; font-weight: 800; color: #1C1F3B; margin-bottom: 8px; }
.feat-card p { font-size: 13px; color: #676879; line-height: 1.7; }

.how-section { padding: 80px 32px; background: #fff; }
.steps-row { display: flex; align-items: flex-start; justify-content: center; gap: 20px; flex-wrap: wrap; text-align: left; }
.step-item { max-width: 220px; }
.step-num { width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #6161FF, #0073EA); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; margin-bottom: 14px; }
.step-item h3 { font-size: 15px; font-weight: 800; color: #1C1F3B; margin-bottom: 8px; }
.step-item p { font-size: 13px; color: #676879; line-height: 1.7; }
.step-arrow { font-size: 24px; color: #D0D4E4; padding-top: 10px; }

.cta-section { padding: 80px 32px; background: linear-gradient(160deg, #0F1035, #1C1F4A, #2D1B5A); }
.cta-inner { max-width: 600px; margin: 0 auto; text-align: center; }
.cta-inner h2 { font-size: 34px; font-weight: 900; color: #fff; margin-bottom: 12px; }
.cta-inner > p { font-size: 14px; color: rgba(255,255,255,.6); margin-bottom: 36px; line-height: 1.7; }
.contact-form { display: flex; flex-direction: column; gap: 10px; text-align: left; }
.cf-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.contact-form input, .contact-form textarea {
  width: 100%; border: 1.5px solid rgba(255,255,255,.15); border-radius: 9px;
  padding: 11px 14px; font-size: 14px; color: #fff; background: rgba(255,255,255,.08);
  outline: none; transition: .15s; font-family: inherit;
}
.contact-form input::placeholder, .contact-form textarea::placeholder { color: rgba(255,255,255,.35); }
.contact-form input:focus, .contact-form textarea:focus { border-color: rgba(97,97,255,.6); background: rgba(255,255,255,.12); }
.contact-form textarea { resize: vertical; min-height: 100px; }
.contact-ok { background: rgba(0,200,117,.15); border: 1px solid rgba(0,200,117,.3); color: #00C875; padding: 12px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; }
.contact-err { background: rgba(226,68,92,.15); border: 1px solid rgba(226,68,92,.3); color: #E2445C; padding: 12px 16px; border-radius: 8px; font-size: 13px; }

footer { background: #0F1035; padding: 28px 32px; }
.footer-inner { max-width: 900px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; font-size: 12px; color: rgba(255,255,255,.3); }
.footer-brand { display: flex; align-items: center; gap: 8px; color: rgba(255,255,255,.6); font-weight: 600; }

@media (max-width: 860px) {
  .hero-title { font-size: 32px; }
  .hero { padding: 60px 24px 40px; gap: 36px; }
  .hero-card { width: 280px; }
  .features-grid { grid-template-columns: 1fr 1fr; }
  .stats-inner { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .nav-links { display: none; }
  .hero-title { font-size: 26px; }
  .features-grid { grid-template-columns: 1fr; }
  .cf-row { grid-template-columns: 1fr; }
  .steps-row { flex-direction: column; align-items: center; text-align: center; }
  .step-arrow { display: none; }
  .hero-card { display: none; }
  .stats-inner { grid-template-columns: repeat(2, 1fr); }
}
</style>
