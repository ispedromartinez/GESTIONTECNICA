<template>
  <div class="frame-wrap">
    <iframe
      src="/tigo-frame"
      class="full-frame"
      allow="camera; microphone"
      title="Informe TIGO"
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
