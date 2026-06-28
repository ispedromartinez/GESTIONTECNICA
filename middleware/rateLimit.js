// ── Limitador de peticiones en memoria (sin dependencias) ───────
// Frena fuerza bruta (login) y spam (formulario de contacto).
// Nota: el contador vive en memoria del proceso. Para varios procesos
// (pm2 en modo cluster) conviene un store compartido como Redis.
function rateLimit({ windowMs = 60000, max = 30, message = 'Demasiadas solicitudes, intenta más tarde.' } = {}) {
  const hits = new Map(); // ip -> { count, reset }

  // Limpieza periódica de entradas vencidas (no bloquea el cierre del proceso)
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of hits) if (now > rec.reset) hits.delete(ip);
  }, windowMs);
  if (timer.unref) timer.unref();

  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    let rec = hits.get(ip);
    if (!rec || now > rec.reset) { rec = { count: 0, reset: now + windowMs }; hits.set(ip, rec); }
    rec.count++;
    if (rec.count > max) {
      res.setHeader('Retry-After', Math.ceil((rec.reset - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { rateLimit };
