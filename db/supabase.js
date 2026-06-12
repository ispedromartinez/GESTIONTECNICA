const { createClient } = require('@supabase/supabase-js');

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  : null;

const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'documentos-word';

if (supabase) {
  supabase.from('informes_clima').select('id').limit(1)
    .then(({ error }) => {
      if (error) console.error('⚠️  Supabase conectado pero error de acceso:', error.message);
      else console.log('✅ Supabase conectado correctamente');
    });
} else {
  console.warn('⚠️  Supabase NO configurado — falta SUPABASE_URL o SUPABASE_KEY. Usando archivos locales.');
}

function sanitizeSearch(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw
    .replace(/\0/g, '')
    .replace(/[,()]/g, ' ')
    .trim()
    .slice(0, 100);
  return clean || null;
}

function escapeLike(s) {
  return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

async function storageUpload(buffer, storagePath) {
  if (!supabase) return;
  const { error } = await supabase.storage.from(SUPABASE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true
    });
  if (error) console.error('storageUpload error:', error.message);
}

async function storageDownload(storagePath) {
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).download(storagePath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function storageMove(fromPath, toPath) {
  if (!supabase) return;
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).move(fromPath, toPath);
  if (error) console.error('storageMove error:', error.message);
}

async function storageRemove(paths) {
  if (!supabase) return;
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove(paths);
  if (error) console.error('storageRemove error:', error.message);
}

module.exports = {
  supabase, SUPABASE_BUCKET,
  sanitizeSearch, escapeLike,
  storageUpload, storageDownload, storageMove, storageRemove
};
