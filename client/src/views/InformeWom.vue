<template>
  <div class="frame-wrap">
    <iframe
      src="/wom-frame"
      class="full-frame"
      allow="camera; microphone"
      title="Informe WOM"
    ></iframe>
  </div>
</template>

<style scoped>
.frame-wrap {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
}
.full-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
</style>
