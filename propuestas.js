// Persistencia privada para propuestas MCP. La migración SQL crea esta tabla.
async function hash(s) {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function guardarPropuesta(db, tipo, contenido, agente) {
  const clave = tipo === 'candidato'
    ? contenido.contenido.doi_o_url.trim().toLowerCase()
    : [contenido.ficha_id, contenido.campo, contenido.valor.trim(), contenido.pagina].join('|');
  const id = (tipo === 'candidato' ? 'p_' : 's_') + (await hash(tipo + ':' + clave)).slice(0, 20);
  const creadoEn = new Date().toISOString();
  const item = { ...contenido, id, estado: 'pendiente_revision', creado_en: creadoEn,
    siguiente_paso: 'La propuesta quedó en la cola privada. Una persona revisora debe contrastarla con la fuente antes de publicarla.' };
  const result = await db.prepare(
    'INSERT OR IGNORE INTO propuestas (id, tipo, clave, estado, contenido, agente, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tipo, clave, item.estado, JSON.stringify(item), agente, creadoEn).run();
  const row = await db.prepare('SELECT id, estado, contenido, creado_en FROM propuestas WHERE id = ?').bind(id).first();
  if (!row) { throw new Error('La propuesta no se pudo recuperar después de guardarla.'); }
  return { ...JSON.parse(row.contenido), id: row.id, estado: row.estado, creado_en: row.creado_en, duplicado: result.meta?.changes === 0 };
}

export async function listarPropuestas(db) {
  const result = await db.prepare('SELECT id, tipo, estado, agente, creado_en, contenido FROM propuestas ORDER BY creado_en DESC LIMIT 100').all();
  return (result.results || []).map((r) => ({ ...r, contenido: JSON.parse(r.contenido) }));
}

export async function revisarPropuesta(db, id, estado, revisor) {
  if (!['aceptada', 'rechazada'].includes(estado)) { return null; }
  const fecha = new Date().toISOString();
  const result = await db.prepare('UPDATE propuestas SET estado = ?, revisor = ?, revisado_en = ? WHERE id = ? AND estado = ?')
    .bind(estado, revisor, fecha, id, 'pendiente_revision').run();
  if (result.meta?.changes !== 1) { return null; }
  return { id, estado, revisor, revisado_en: fecha, nota: 'Aceptar una propuesta no publica una ficha. La publicación requiere una revisión del catálogo canónico.' };
}
