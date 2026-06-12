<template>
  <div class="page">
    <header>
      <div class="hdr-logo-wrap">
        <img src="/assets/icetel-logo.png" alt="ICETEL" class="hdr-logo">
      </div>
      <span class="hdr-tagline">Sistema de Gestión de Informes</span>
    </header>

    <div class="hero">
      <div class="hero-orb1"></div>
      <div class="hero-orb2"></div>
      <h1>Seleccione el Proyecto</h1>
      <p>Elija el cliente para ingresar al módulo correspondiente</p>
    </div>

    <main>
      <div class="cards">
        <router-link to="/tigo" class="card tigo">
          <div class="card-top"></div>
          <div class="card-inner">
            <div class="card-logo">
              <img src="/assets/tigo-logo.png" alt="Tigo">
            </div>
            <span class="card-label">Proyecto TIGO</span>
            <span class="card-desc">Informes de mantenimiento<br>de equipos de clima</span>
          </div>
          <button class="card-btn">Ingresar →</button>
        </router-link>

        <router-link to="/wom" class="card wom">
          <div class="card-top"></div>
          <div class="card-inner">
            <div class="card-logo">
              <span class="wom-text">wom</span>
            </div>
            <span class="card-label">Proyecto WOM</span>
            <span class="card-desc">Informes de mantenimiento<br>de equipos de clima</span>
          </div>
          <button class="card-btn">Ingresar →</button>
        </router-link>
      </div>
    </main>

    <footer>ICETEL © 2026 — Sistema de Gestión de Informes / Control y Gestión</footer>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; min-height: 100vh; align-items: center; background: #F6F7FB; }

header {
  width: 100%; background: #1C1F3B; padding: 14px 24px;
  display: flex; align-items: center; justify-content: space-between;
  box-shadow: 0 2px 16px rgba(0,0,0,.25);
}
.hdr-logo-wrap { background: #fff; border-radius: 8px; padding: 5px 14px; display: flex; align-items: center; }
.hdr-logo { height: 40px; object-fit: contain; }
.hdr-tagline { color: rgba(255,255,255,.5); font-size: 12px; font-weight: 500; }

.hero {
  width: 100%; background: linear-gradient(135deg, #1C1F3B 0%, #2D3060 55%, #3B2070 100%);
  padding: 52px 24px 60px; text-align: center; position: relative; overflow: hidden;
}
.hero-orb1, .hero-orb2 { position: absolute; border-radius: 50%; pointer-events: none; }
.hero-orb1 { width: 420px; height: 420px; background: rgba(97,97,255,.12); top: -120px; left: -120px; }
.hero-orb2 { width: 320px; height: 320px; background: rgba(0,115,234,.1); bottom: -100px; right: -80px; }
.hero h1 { font-size: 28px; font-weight: 800; color: #fff; letter-spacing: -.4px; margin-bottom: 10px; position: relative; z-index: 1; }
.hero p { font-size: 13px; color: rgba(255,255,255,.58); position: relative; z-index: 1; }

main { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 40px 20px 52px; width: 100%; max-width: 860px; }

.cards { display: flex; gap: 20px; width: 100%; justify-content: center; flex-wrap: wrap; }
.card {
  flex: 1 1 260px; max-width: 320px; background: #fff; border-radius: 16px;
  padding: 0 0 28px; display: flex; flex-direction: column; align-items: center;
  box-shadow: 0 2px 12px rgba(0,0,0,.07), 0 1px 4px rgba(0,0,0,.04);
  cursor: pointer; text-decoration: none; transition: transform .2s, box-shadow .2s, border-color .2s;
  border: 1.5px solid #E8EAED; overflow: hidden;
}
.card:hover { transform: translateY(-5px); box-shadow: 0 14px 44px rgba(0,0,0,.14); border-color: transparent; }
.card:active { transform: translateY(-1px); }
.card-top { width: 100%; height: 6px; border-radius: 14px 14px 0 0; }
.tigo .card-top { background: linear-gradient(90deg, #0073EA, #1976D2); }
.wom  .card-top { background: linear-gradient(90deg, #6161FF, #7B1FA2); }
.card-inner { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 30px 28px 0; width: 100%; }
.card-logo { height: 80px; display: flex; align-items: center; justify-content: center; }
.card-logo img { max-height: 80px; max-width: 200px; object-fit: contain; }
.wom-text { font-size: 56px; font-weight: 900; color: #7B1FA2; letter-spacing: -3px; line-height: 1; font-style: italic; }
.card-label { font-size: 13px; font-weight: 700; color: #323338; letter-spacing: .2px; text-transform: uppercase; }
.card-desc { font-size: 12px; color: #676879; text-align: center; line-height: 1.65; }
.card-btn {
  width: calc(100% - 56px); margin: 16px 28px 0; padding: 11px 24px;
  border-radius: 8px; font-size: 13px; font-weight: 600; border: none; cursor: pointer;
  transition: opacity .15s;
}
.tigo .card-btn { background: #0073EA; color: #fff; }
.wom  .card-btn { background: #6161FF; color: #fff; }
.card-btn:hover { opacity: .88; }

footer { padding: 20px; color: #B0B3C0; font-size: 11px; text-align: center; background: #F6F7FB; width: 100%; border-top: 1px solid #E8EAED; }
@media (max-width: 480px) { .hero h1 { font-size: 22px; } .hdr-tagline { display: none; } }
</style>
