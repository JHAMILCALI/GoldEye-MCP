import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { catalogoInicial, proyeccionPublica, catalogoJsonLd, handleMcp } from './handler.js';
import { guardarPropuesta } from './propuestas.js';
import worker from './worker.js';

const META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'AgentePrueba', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} };
const rpc = (method, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: META } });
const call = (cat, name, args = {}, ctx = {}) => handleMcp(rpc('tools/call', { name, arguments: args }), cat, ctx);
let count = 0;
async function test(name, fn) { await fn(); console.log('ok  ' + name); count++; }

function fixture() {
  const cat = catalogoInicial();
  const valid = {
    id: 'pub-1', titulo: 'Estudio de prueba sobre peces en el Kaka', matriz: 'pez', estado: 'publicado',
    autoria: 'Autora de prueba', metodo: 'Análisis de laboratorio',
    fecha_muestreo: '2020-05-12', fecha_publicacion: '2022-01-01',
    ubicacion_publica: 'Río Kaka, Beni', fuente: 'https://example.org/estudio', pagina: 7,
    licencia: 'CC BY', revisor: { nombre: 'Revisor de prueba' }, version: 2,
    permiso: { publicacion: true, vigente_hasta: '2030-01-01' }, nota_privada: 'Nunca debe salir'
  };
  cat.fichas.push(valid);
  cat.fichas.push({ ...valid, id: 'caducada', permiso: { publicacion: true, vigente_hasta: '2020-01-01' } });
  cat.fichas.push({ ...valid, id: 'restringida', ubicacion_restringida: true });
  cat.fichas.push({ ...valid, id: 'sin-firma', revisor: null });
  cat.fichas.push({ ...valid, id: 'sin-pagina', pagina: null, seccion: null });
  cat.fichas.push({ ...valid, id: 'pendiente', estado: 'borrador' });
  return cat;
}

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('./migrations/0001_propuestas.sql', import.meta.url), 'utf8'));
  return { prepare(sql) {
    const statement = sqlite.prepare(sql);
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async run() { return { meta: { changes: statement.run(...values).changes } }; },
      async first() { return statement.get(...values) || null; },
      async all() { return { results: statement.all(...values) }; }
    };
  } };
}

function mcpRequest(name, args = {}) {
  return new Request('https://goldeye.example/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': name },
    body: JSON.stringify(rpc('tools/call', { name, arguments: args }))
  });
}

await test('la proyección excluye borradores, candidatos, caducados y campos privados', () => {
  const publicCat = proyeccionPublica(fixture(), '2026-11-25');
  assert.deepEqual(publicCat.fichas.map((f) => f.id), ['pub-1']);
  assert.deepEqual(publicCat.candidatos, []);
  assert.deepEqual(publicCat.vacios, []);
  assert.equal(publicCat.fichas[0].nota_privada, undefined);
  assert.equal(publicCat.fichas[0].ubicacion_restringida, undefined);
});

await test('búsqueda, ficha, recurso y exportación usan la misma proyección', () => {
  const cat = fixture();
  const search = call(cat, 'buscar_estudios', { consulta: 'peces', ubicacion: 'Kaka', matriz: 'pez', desde: 2020, hasta: 2020 });
  assert.deepEqual(search.result.structuredContent.resultados.map((f) => f.id), ['pub-1']);
  assert.equal(call(cat, 'buscar_estudios', { desde: 2021 }).result.structuredContent.total, 0);
  assert.equal(call(cat, 'obtener_ficha', { id: 'f001' }).result.structuredContent.codigo, 'no_encontrada');
  const ficha = call(cat, 'obtener_ficha', { id: 'pub-1' }).result.structuredContent;
  assert.match(ficha.cita_sugerida, /https:\/\/example\.org\/estudio, p\. 7/);
  assert.equal(ficha.ficha.nota_privada, undefined);
  const resource = handleMcp(rpc('resources/read', { uri: 'goldeye://catalogo' }), cat, { base: 'https://goldeye.example' });
  assert.deepEqual(JSON.parse(resource.result.contents[0].text).hasPart.map((f) => f.identifier), ['pub-1']);
  const exportado = call(cat, 'exportar_anexo', { formato: 'json' }, { cuenta: { creditos: 10 }, pagosDisponibles: true });
  assert.deepEqual(JSON.parse(exportado.result.structuredContent.anexo).map((f) => f.id), ['pub-1']);
});

await test('resultado vacío y vacíos expresan el alcance del catálogo', () => {
  const cat = catalogoInicial();
  const search = call(cat, 'buscar_estudios').result;
  assert.equal(search.structuredContent.total, 0);
  assert.match(search.content[0].text, /no prueba ausencia/);
  const gaps = call(cat, 'listar_vacios').result.structuredContent;
  assert.equal(gaps.total, 5);
  assert.ok(gaps.vacios.every((v) => v.confirmado === false));
  assert.equal(catalogoJsonLd(cat, 'https://goldeye.example').hasPart.length, 0);
});

await test('manifiesto moderno y compatibilidad anterior', () => {
  const discovery = handleMcp(rpc('server/discover'), catalogoInicial(), {});
  assert.deepEqual(discovery.result.supportedVersions, ['2026-07-28', '2025-11-25']);
  const tools = handleMcp(rpc('tools/list'), catalogoInicial(), {}).result.tools.map((t) => t.name);
  assert.equal(tools.length, 5);
  assert.ok(!tools.includes('publicar_ficha'));
  assert.ok(!tools.includes('generar_informe'));
  const legacy = handleMcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Legacy', version: '1' } } }, catalogoInicial(), {});
  assert.equal(legacy.result.protocolVersion, '2025-11-25');
});

await test('Worker no entrega el borrador en JSON ni MCP', async () => {
  const catalogResponse = await worker.fetch(new Request('https://goldeye.example/catalog.json'), {});
  assert.equal(catalogResponse.headers.get('Cache-Control'), 'no-store');
  const catalog = await catalogResponse.json();
  assert.deepEqual(catalog.hasPart, []);
  const search = await (await worker.fetch(mcpRequest('buscar_estudios'), {})).json();
  assert.equal(search.result.structuredContent.total, 0);
  const ficha = await (await worker.fetch(mcpRequest('obtener_ficha', { id: 'f001' }), {})).json();
  assert.equal(ficha.result.structuredContent.codigo, 'no_encontrada');
});

await test('Worker entrega el icono publico como PNG y SVG', async () => {
  const png = await worker.fetch(new Request('https://goldeye.example/icon.png'), {});
  assert.equal(png.status, 200);
  assert.equal(png.headers.get('Content-Type'), 'image/png');
  assert.deepEqual([...new Uint8Array(await png.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const svg = await worker.fetch(new Request('https://goldeye.example/icon.svg'), {});
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('Content-Type'), /^image\/svg\+xml/);
  assert.match(await svg.text(), /viewBox="0 0 512 512"/);
});

await test('Worker exige encabezados del protocolo moderno', async () => {
  const body = JSON.stringify(rpc('tools/call', { name: 'buscar_estudios', arguments: {} }));
  const request = new Request('https://goldeye.example/mcp', { method: 'POST', headers: { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call' }, body });
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, -32020);
});

await test('sin D1, la propuesta no afirma que fue guardada', async () => {
  const result = await (await worker.fetch(mcpRequest('proponer_candidato', { doi_o_url: '10.1000/prueba', motivo: 'Prueba de conexión' }), {})).json();
  assert.equal(result.result.isError, true);
  assert.equal(result.result.structuredContent.codigo, 'almacenamiento_no_configurado');
});

await test('D1 persiste y deduplica propuestas entre solicitudes', async () => {
  const db = d1(), env = { PROPOSALS_DB: db, ADMIN_TOKEN: 'admin-test' };
  const request = () => mcpRequest('proponer_candidato', { doi_o_url: '10.1000/prueba', motivo: 'Estudio relevante', matriz: 'pez' });
  const first = await (await worker.fetch(request(), env)).json();
  const second = await (await worker.fetch(request(), env)).json();
  const id = first.result.structuredContent.propuesta.id;
  assert.match(id, /^p_[a-f0-9]{20}$/);
  assert.equal(first.result.structuredContent.propuesta.estado, 'pendiente_revision');
  assert.equal(second.result.structuredContent.propuesta.id, id);
  assert.equal(second.result.structuredContent.propuesta.duplicado, true);
  const adminHeaders = { 'X-Admin-Token': 'admin-test' };
  const list = await (await worker.fetch(new Request('https://goldeye.example/v1/admin/propuestas', { headers: adminHeaders }), env)).json();
  assert.equal(list.propuestas.length, 1);
  const reviewed = await (await worker.fetch(new Request('https://goldeye.example/v1/admin/propuestas/' + id, {
    method: 'PATCH', headers: { ...adminHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'aceptada', revisor: 'Revisor de prueba' })
  }), env)).json();
  assert.equal(reviewed.estado, 'aceptada');
  assert.equal((await (await worker.fetch(mcpRequest('buscar_estudios'), env)).json()).result.structuredContent.total, 0);
});

await test('sugerencias usan identificador estable en la cola privada', async () => {
  const db = d1(), suggestion = { ficha_id: 'pub-1', campo: 'metodo', valor: 'Otro método', pagina: 7 };
  const first = await guardarPropuesta(db, 'sugerencia', suggestion, 'AgentePrueba');
  const second = await guardarPropuesta(db, 'sugerencia', suggestion, 'AgentePrueba');
  assert.equal(first.id, second.id);
  assert.equal(second.duplicado, true);
});

console.log(`\n${count} pruebas pasaron`);
