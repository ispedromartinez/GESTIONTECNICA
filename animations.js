/* animations.js — activa el fade-in de página. Mínimo a propósito. */
(function(){
  function reveal(){ document.body.classList.add('loaded'); }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', reveal);
  else reveal();
  // Fallback duro: si algo falla, garantiza visibilidad tras 1s.
  setTimeout(reveal, 1000);
})();
