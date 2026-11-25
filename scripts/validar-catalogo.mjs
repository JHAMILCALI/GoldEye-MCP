import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogoInicial, catalogoJsonLd, MATRICES } from '../handler.js';

const cat = catalogoInicial();
const ids = new Set();
const fecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
for (const item of [...cat.fichas, ...cat.candidatos]) {
  assert.ok(item.id && !ids.has(item.id), `ID duplicado o vacío: ${item.id}`);
  ids.add(item.id);
  if (item.estado !== 'publicado') { continue; }
  assert.ok(item.titulo && MATRICES.includes(item.matriz), `Título o matriz inválida: ${item.id}`);
  assert.ok(fecha(item.fecha_publicacion), `Fecha de publicación inválida: ${item.id}`);
  assert.ok(Object.hasOwn(item, 'fecha_muestreo') && (item.fecha_muestreo === null || fecha(item.fecha_muestreo)), `Fecha de muestreo inválida: ${item.id}`);
  assert.ok(item.fuente && new URL(item.fuente).protocol === 'https:', `Fuente HTTPS requerida: ${item.id}`);
  assert.ok((Number.isInteger(item.pagina) && item.pagina > 0) || item.seccion, `Página o sección requerida: ${item.id}`);
  assert.ok(item.revisor?.nombre?.trim(), `Nombre de revisor requerido: ${item.id}`);
  assert.ok(Number.isInteger(item.version) && item.version > 0, `Versión requerida: ${item.id}`);
  assert.ok(item.permiso?.publicacion === true, `Permiso de publicación requerido: ${item.id}`);
  assert.ok(!item.ubicacion_restringida, `Ubicación restringida: ${item.id}`);
}

const saved = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));
const generated = catalogoJsonLd(cat, saved.url.replace(/\/catalog\.json$/, ''));
assert.deepEqual(saved, generated, 'catalog.json está desactualizado; ejecuta npm run generar-publico');
console.log(`Catálogo válido: ${cat.fichas.filter((f) => f.estado === 'publicado').length} ficha(s) marcadas como publicadas.`);
