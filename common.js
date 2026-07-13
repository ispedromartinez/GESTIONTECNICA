// Helpers compartidos por TODAS las páginas. Cargar (sin defer) antes del
// <script> de cada página. Fuente única de esc/escArg — antes cada página
// tenía su propia copia y el drift causó un XSS (WOM no las tenía).
//
// REGLA: todo dato del servidor va por esc() antes de innerHTML, y por
// escArg() dentro de onclick="...". Ver CLAUDE.md.
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escArg(s){
  return esc(String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"));
}
