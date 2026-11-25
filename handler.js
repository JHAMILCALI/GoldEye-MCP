// Servidor MCP de lectura y propuesta para GoldEye Trace. Sin dependencias.
import catalogoCanonico from './catalogo-canonico.json' with { type: 'json' };
// Protocolo: revisión 2026-07-28 (sin estado, con server/discover) y compatibilidad con 2025-11-25 (initialize).
// Regla de gobierno: un agente lee y propone; solo una persona revisora confirma campos y publica fichas.

export const VERSIONES = ['2026-07-28', '2025-11-25'];
export const SERVER_INFO = { name: 'goldeye_trace', title: 'GoldEye Trace', version: '0.2.0' };
export const INSTRUCCIONES = 'Catálogo verificable de estudios sobre mercurio en Bolivia. Lee con buscar_estudios, listar_vacios y obtener_ficha. Un agente propone con proponer_candidato y sugerir_valor; solo una persona revisora confirma campos y publica fichas. Cita siempre con cita_sugerida y no redistribuyas PDF de terceros.';
export const MATRICES = ['pez', 'agua', 'sedimento', 'aire', 'humano_agregado'];
export const CAMPOS = ['muestra', 'metodo', 'fecha_muestreo', 'fecha_publicacion', 'ubicacion_publica', 'licencia', 'fuente', 'matriz'];
export const REGLAS = [
  '# Reglas para agentes',
  '',
  '1. Un agente lee, busca y propone. Solo una persona revisora confirma un campo y publica una ficha.',
  '2. Cada campo publicado lleva su página de respaldo y el nombre del revisor.',
  '3. Se guardan metadato, enlace, hash SHA 256 y cita corta. No se redistribuye el PDF de un tercero salvo que la licencia lo permita.',
  '4. No se piden ni se infieren datos individuales de salud. Solo resultados agregados ya publicados.',
  '5. Las comunidades deciden la precisión de la ubicación. No se nombran cooperativas ni operaciones.',
  '6. Toda sugerencia de un agente queda marcada como sugerida por agente hasta que una persona la firme.',
  '7. Cita siempre con el campo cita_sugerida de cada resultado.'
].join('\n');

export function catalogoInicial() {
  return { ...structuredClone(catalogoCanonico), propuestas: [], sugerencias: [] };
}

// Única salida permitida para web, archivos, REST y MCP. La lista de campos evita
// publicar por accidente notas internas o coordenadas privadas de una ficha.
export function proyeccionPublica(cat, hoy = new Date().toISOString().slice(0, 10)) {
  const fichas = (cat.fichas || []).filter((f) =>
    f.estado === 'publicado' && f.permiso?.publicacion === true &&
    (!f.permiso.vigente_hasta || f.permiso.vigente_hasta >= hoy) &&
    !f.ubicacion_restringida && fuenteValida(f.fuente) && /^https:\/\//.test(f.fuente) &&
    (Number.isInteger(f.pagina) && f.pagina > 0 || !!f.seccion) &&
    !!f.revisor?.nombre && !!f.version &&
    Object.hasOwn(f, 'fecha_muestreo') && !!f.fecha_publicacion
  ).map((f) => ({
    id: f.id, titulo: f.titulo, matriz: f.matriz, estado: 'publicado',
    autoria: f.autoria || null, metodo: f.metodo || null, muestra: f.muestra || null,
    fecha_muestreo: f.fecha_muestreo, fecha_publicacion: f.fecha_publicacion,
    ubicacion_publica: f.ubicacion_publica || null, fuente: f.fuente,
    pagina: f.pagina || null, seccion: f.seccion || null, licencia: f.licencia || null,
    revisor: f.revisor.nombre, version: f.version,
    permiso: { publicacion: true, vigente_hasta: f.permiso.vigente_hasta || null }
  }));
  const vacios = (cat.vacios || []).filter((v) => v.confirmado === true && v.publicable === true)
    .map((v) => ({ id: v.id, matriz: v.matriz, titulo: v.titulo, nota: v.nota || null }));
  return { publico: true, actualizado: cat.actualizado, fichas, candidatos: [], vacios, propuestas: [], sugerencias: [] };
}

export function calcularVacios(cat) {
  cat = cat.publico ? cat : proyeccionPublica(cat);
  var out = [];
  MATRICES.forEach(function (m) {
    var n = cat.fichas.filter(function (f) { return f.matriz === m; }).length;
    if (n === 0) { out.push({ tipo: 'calculado', matriz: m, descripcion: 'Sin ficha publicada de ' + m + ' en el catálogo indexado; requiere comprobar fuentes', accion: 'verificar fuentes', confirmado: false }); }
  });
  cat.vacios.forEach(function (v) { out.push({ tipo: 'confirmado', id: v.id, matriz: v.matriz, descripcion: v.titulo, nota: v.nota, confirmado: true }); });
  return out;
}

function citar(f) {
  return [f.autoria || 'Autor no indicado', '(' + f.fecha_publicacion + ').', f.titulo + '.',
    f.fuente + (f.pagina ? ', p. ' + f.pagina : ', sección ' + f.seccion) + '.',
    'Ficha GoldEye ' + f.id + ' v' + f.version + '.'].join(' ');
}

export const HERRAMIENTAS = [
  {
    name: 'buscar_estudios', title: 'Buscar estudios', permiso: 'Lee',
    description: 'Busca únicamente fichas publicadas por texto, matriz, ubicación y año de muestreo.',
    inputSchema: { type: 'object', properties: { consulta: { type: 'string', maxLength: 200 }, matriz: { type: 'string', enum: MATRICES }, ubicacion: { type: 'string', maxLength: 200 }, desde: { type: 'integer', minimum: 1900 }, hasta: { type: 'integer', minimum: 1900 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'listar_vacios', title: 'Listar vacíos de evidencia', permiso: 'Lee',
    description: 'Muestra matrices sin fichas publicadas en este catálogo; no afirma ausencia de estudios en el territorio.',
    inputSchema: { type: 'object', properties: { matriz: { type: 'string', enum: MATRICES } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'obtener_ficha', title: 'Obtener ficha', permiso: 'Lee',
    description: 'Devuelve una ficha con su proveniencia y la cita sugerida.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 100, description: 'Identificador público' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'proponer_candidato', title: 'Proponer candidato', permiso: 'Propone',
    description: 'Propone un estudio por DOI o URL. Se guarda en una cola privada si el servidor tiene almacenamiento configurado.',
    inputSchema: { type: 'object', properties: { doi_o_url: { type: 'string', minLength: 8, maxLength: 2048, description: 'DOI como 10.1000/ejemplo o URL https' }, motivo: { type: 'string', minLength: 8, maxLength: 1000, description: 'Por qué corresponde al catálogo' }, matriz: { type: 'string', enum: MATRICES } }, required: ['doi_o_url', 'motivo'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'sugerir_valor', title: 'Sugerir valor de un campo', permiso: 'Propone',
    description: 'Sugiere el valor de una ficha pública con página de respaldo. Se guarda en una cola privada si hay almacenamiento.',
    inputSchema: { type: 'object', properties: { ficha_id: { type: 'string', minLength: 1, maxLength: 100 }, campo: { type: 'string', enum: CAMPOS }, valor: { type: 'string', minLength: 1, maxLength: 1000 }, pagina: { type: 'integer', minimum: 1 } }, required: ['ficha_id', 'campo', 'valor', 'pagina'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }
];
export const RESERVADAS = ['confirmar_campo', 'publicar_ficha'];
function herramientasDisponibles(ctx) { return HERRAMIENTAS.filter((tool) => tool.permiso !== 'Pago' || ctx.pagosDisponibles === true); }

// Servicios de pago. Leer y proponer siempre es gratis; se cobra el trabajo de armar un entregable.
// Precios de ejemplo para validar con clientes: 1 crédito equivale a Bs 7.
export const PRECIOS = {
  generar_informe: { creditos: 10, bs: 70, usd: 10, que: 'Informe de evidencia por cuenca con citas, vacíos y nota de método' },
  exportar_anexo: { creditos: 5, bs: 35, usd: 5, que: 'Anexo tabular con proveniencia, listo para un reporte institucional' }
};
export const CREDITO_BS = 7;
HERRAMIENTAS.push(
  {
    name: 'generar_informe', title: 'Generar informe de evidencia', permiso: 'Pago',
    description: 'Servicio opcional de pago (10 créditos). Arma un informe en Markdown solo con fichas publicadas, citas y cobertura del catálogo.',
    inputSchema: { type: 'object', properties: { matriz: { type: 'string', enum: MATRICES }, titulo: { type: 'string', description: 'Título para el informe' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'exportar_anexo', title: 'Exportar anexo', permiso: 'Pago',
    description: 'Servicio opcional de pago (5 créditos). Devuelve solo fichas publicadas como tabla CSV o JSON con proveniencia.',
    inputSchema: { type: 'object', properties: { formato: { type: 'string', enum: ['csv', 'json'] } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }
);

// Decide si un servicio de pago puede ejecutarse. ctx.cuenta viene de una clave; ctx.x402 de un pago verificado.
export function cobrar(name, ctx) {
  var pr = PRECIOS[name];
  if (!pr) { return { ok: true }; }
  if (ctx.x402 && ctx.x402.valido) { ctx.cobro = { via: 'x402', usd: pr.usd, ref: ctx.x402.ref || null }; return { ok: true }; }
  if (ctx.cuenta && ctx.cuenta.creditos >= pr.creditos) {
    ctx.cuenta.creditos -= pr.creditos;
    ctx.cobro = { via: 'creditos', creditos: pr.creditos, saldo: ctx.cuenta.creditos };
    return { ok: true };
  }
  return { ok: false, motivo: ctx.cuenta ? 'saldo_insuficiente' : 'pago_requerido', precio: pr };
}
export function opcionesPago(name, ctx) {
  var pr = PRECIOS[name], base = (ctx && ctx.base) || 'https://TU_DOMINIO';
  var o = [{ tipo: 'creditos', como: 'Clave con créditos en el encabezado Authorization: Bearer. Se recargan pagando con QR interbancario boliviano y se acreditan tras confirmar el depósito.', creditos: pr.creditos, bs: pr.bs, recarga: base + '/v1/precios' }];
  if (ctx && ctx.x402cfg) { o.push({ tipo: 'x402', como: 'Pago por llamada para agentes: reintenta la petición con el encabezado X-PAYMENT.', usd: pr.usd, red: ctx.x402cfg.red, activo: ctx.x402cfg.activo, pagar_a: ctx.x402cfg.pagar_a }); }
  return o;
}
function informe(a, cat) {
  var rev = cat.fichas.filter(function (f) { return !a.matriz || f.matriz === a.matriz; });
  var vac = calcularVacios(cat).filter(function (v) { return !a.matriz || v.matriz === a.matriz; });
  var L = ['# ' + (a.titulo || 'Estado de la evidencia sobre mercurio' + (a.matriz ? ': ' + a.matriz : '')), '', 'Generado por GoldEye Trace el ' + cat.actualizado + '. Solo fichas publicadas.', '', '## Fichas publicadas (' + rev.length + ')'];
  if (!rev.length) { L.push('Sin fichas publicadas en el catálogo indexado bajo este filtro.'); }
  rev.forEach(function (f) { L.push('- ' + citar(f)); });
  L.push('', '## Vacíos de evidencia (' + vac.length + ')');
  vac.forEach(function (v) { L.push('- ' + v.descripcion + (v.nota ? '. ' + v.nota : '')); });
  L.push('', '## Nota de método', 'La ausencia de fichas bajo un filtro no prueba ausencia de estudios o contaminación en el territorio. No incluye datos individuales de salud.');
  return L.join('\n');
}
function anexo(a, cat) {
  var rows = cat.fichas.map(function (r) { return { id: r.id, titulo: r.titulo, anio: r.fecha_publicacion?.slice(0, 4) || '', matriz: r.matriz, estado: r.estado, licencia: r.licencia || '', revisor: r.revisor, cita: citar(r) }; });
  if (a.formato === 'json') { return JSON.stringify(rows); }
  var cols = ['id', 'titulo', 'anio', 'matriz', 'estado', 'licencia', 'revisor', 'cita'];
  return [cols.join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return '"' + String(r[c]).replace(/"/g, '""') + '"'; }).join(','); })).join('\n');
}


function validar(schema, args) {
  var props = schema.properties || {}, req = schema.required || [], k;
  if (args === undefined || args === null) { args = {}; }
  if (typeof args !== 'object' || Array.isArray(args)) { return 'Los argumentos deben ser un objeto.'; }
  for (var i = 0; i < req.length; i++) { if (args[req[i]] === undefined) { return 'Falta el argumento obligatorio: ' + req[i] + '.'; } }
  for (k in args) {
    if (!props[k]) { return 'Argumento desconocido: ' + k + '.'; }
    var p = props[k], v = args[k];
    if (p.type === 'string' && typeof v !== 'string') { return 'El argumento ' + k + ' debe ser texto.'; }
    if (p.type === 'string' && p.minLength && v.trim().length < p.minLength) { return 'El argumento ' + k + ' es demasiado corto.'; }
    if (p.type === 'string' && p.maxLength && v.length > p.maxLength) { return 'El argumento ' + k + ' es demasiado largo.'; }
    if (p.type === 'integer' && !(typeof v === 'number' && Math.floor(v) === v)) { return 'El argumento ' + k + ' debe ser un entero.'; }
    if (p.enum && p.enum.indexOf(v) < 0) { return 'El argumento ' + k + ' debe ser uno de: ' + p.enum.join(', ') + '.'; }
    if (p.minimum !== undefined && v < p.minimum) { return 'El argumento ' + k + ' debe ser al menos ' + p.minimum + '.'; }
  }
  return '';
}

var RE_DOI = /^10\.\d{4,9}\/\S+$/;
function fuenteValida(value) {
  if (typeof value !== 'string') { return false; }
  if (RE_DOI.test(value)) { return true; }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

function ejecutar(name, a, cat, ctx) {
  var hoy = ctx.hoy, i;
  if (name === 'buscar_estudios') {
    var q = (a.consulta || '').toLowerCase(), loc = (a.ubicacion || '').toLowerCase();
    var res = cat.fichas.filter(function (r) {
      var anyo = Number((r.fecha_muestreo || '').slice(0, 4));
      return (!q || [r.titulo, r.autoria, r.metodo, r.ubicacion_publica].some((v) => String(v || '').toLowerCase().includes(q))) &&
        (!loc || String(r.ubicacion_publica || '').toLowerCase().includes(loc)) &&
        (!a.matriz || r.matriz === a.matriz) && (!a.desde || anyo >= a.desde) && (!a.hasta || anyo <= a.hasta);
    }).map(function (r) { return { id: r.id, titulo: r.titulo, matriz: r.matriz, ubicacion_publica: r.ubicacion_publica, fecha_muestreo: r.fecha_muestreo, fecha_publicacion: r.fecha_publicacion, estado: r.estado, cita_sugerida: citar(r) }; });
    return { texto: res.length + ' resultado(s).' + (res.length ? '' : ' Sin fichas publicadas en el catálogo indexado bajo esos filtros; esto no prueba ausencia de estudios o contaminación.'), estructura: { total: res.length, resultados: res, alcance: 'Solo fichas publicadas de este catálogo' } };
  }
  if (name === 'listar_vacios') {
    var v = calcularVacios(cat).filter(function (x) { return !a.matriz || x.matriz === a.matriz; });
    return { texto: v.length + ' matriz(ces) sin ficha publicada o vacío(s) confirmado(s) en este catálogo.', estructura: { total: v.length, vacios: v, alcance: 'La falta de fichas no prueba que falten estudios en el territorio.' } };
  }
  if (name === 'obtener_ficha') {
    var f = cat.fichas.filter(function (r) { return r.id === a.id; })[0];
    if (!f) { return { texto: 'No hay una ficha pública con ese identificador.', estructura: { codigo: 'no_encontrada' }, error: true }; }
    var prov = {
      entidad: f.id,
      generada_por: { actividad: 'revisión humana', agente: { tipo: 'Person', rol: 'revisor', nombre: f.revisor } },
      fuente: f.fuente, pagina: f.pagina, seccion: f.seccion, version: f.version
    };
    return { texto: 'Ficha publicada ' + f.id + '.', estructura: { ficha: f, proveniencia: prov, cita_sugerida: citar(f) } };
  }
  if (name === 'proponer_candidato') {
    var fuente = a.doi_o_url.trim();
    if (!fuenteValida(fuente)) { return { texto: 'doi_o_url debe ser un DOI o una URL HTTPS válida.', estructura: { codigo: 'fuente_invalida' }, error: true }; }
    var slug = fuente.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
    var dup = cat.propuestas.filter(function (p) { return p.archivo === 'candidatos/' + slug + '.json'; })[0];
    if (dup) { return { texto: 'Ya estaba propuesto: ' + dup.id + '.', estructura: { duplicado: true, propuesta: dup } }; }
    var id = 'p' + String(cat.propuestas.length + 1).padStart(3, '0');
    var prop = {
      id: id, archivo: 'candidatos/' + slug + '.json', estado: 'preparada, pendiente de almacenamiento y revisión humana',
      contenido: { tipo: 'candidato', doi_o_url: fuente, motivo: a.motivo, matriz: a.matriz || 'por_clasificar', estado: 'candidato', prov: { agente: { tipo: 'SoftwareAgent', identificador: ctx.cliente || 'agente externo' }, actividad: 'proponer_candidato', fecha: hoy } },
      siguiente_paso: 'El servidor debe guardar la propuesta o devolver este archivo para un pull request.'
    };
    cat.propuestas.push(prop);
    return { texto: 'Propuesta preparada; falta confirmar almacenamiento y revisión humana.', estructura: { propuesta: prop } };
  }
  if (name === 'sugerir_valor') {
    var fi = cat.fichas.filter(function (r) { return r.id === a.ficha_id; })[0];
    if (!fi) { return { texto: 'No existe la ficha ' + a.ficha_id + '.', estructura: { codigo: 'no_encontrada' }, error: true }; }
    var val = a.valor.trim();
    if (!val) { return { texto: 'El valor no puede estar vacío.', estructura: { codigo: 'valor_vacio' }, error: true }; }
    if (a.campo === 'fuente' && !fuenteValida(val)) { return { texto: 'Para fuente escribe un DOI o una URL HTTPS válida.', estructura: { codigo: 'fuente_invalida' }, error: true }; }
    if (['fecha_muestreo', 'fecha_publicacion'].includes(a.campo) && !/^\d{4}-\d{2}-\d{2}$/.test(val)) { return { texto: 'Escribe la fecha como AAAA-MM-DD.', estructura: { codigo: 'fecha_invalida' }, error: true }; }
    if (a.campo === 'matriz' && !MATRICES.includes(val)) { return { texto: 'Matriz no reconocida.', estructura: { codigo: 'matriz_invalida' }, error: true }; }
    var sid = 's' + String(cat.sugerencias.length + 1).padStart(3, '0');
    var sg = { id: sid, ficha_id: fi.id, campo: a.campo, valor: val, pagina: a.pagina, estado: 'preparada, pendiente de almacenamiento y firma', prov: { agente: { tipo: 'SoftwareAgent', identificador: ctx.cliente || 'agente externo' }, actividad: 'sugerir_valor', fecha: hoy } };
    cat.sugerencias.push(sg);
    return { texto: 'Sugerencia preparada; falta confirmar almacenamiento y revisión humana.', estructura: { sugerencia: sg } };
  }
  if (name === 'generar_informe') { var md = informe(a, cat); return { texto: 'Informe generado.', estructura: { formato: 'markdown', informe: md, cobro: ctx.cobro } }; }
  if (name === 'exportar_anexo') { var ax = anexo(a, cat); return { texto: 'Anexo generado.', estructura: { formato: a.formato || 'csv', anexo: ax, cobro: ctx.cobro } }; }
  return null;
}

function ok(id, result) { return { jsonrpc: '2.0', id: id, result: result }; }
function err(id, code, message, data) { var e = { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code: code, message: message } }; if (data) { e.error.data = data; } return e; }
var META_SERVER = { 'io.modelcontextprotocol/serverInfo': SERVER_INFO };
var CACHE = { ttlMs: 60000, cacheScope: 'public' };
var NO_CACHE = { ttlMs: 0, cacheScope: 'public' };

export function catalogoJsonLd(cat, base) {
  base = base || 'https://TU_DOMINIO';
  cat = cat.publico ? cat : proyeccionPublica(cat);
  return {
    '@context': { '@vocab': 'https://schema.org/', prov: 'http://www.w3.org/ns/prov#' },
    '@type': 'Dataset',
    name: 'GoldEye Trace: catálogo de estudios sobre mercurio en Bolivia',
    description: 'Solo fichas publicadas con permiso vigente y revisión humana. La ausencia de fichas no prueba ausencia de estudios.',
    dateModified: cat.actualizado,
    url: base + '/catalog.json',
    keywords: ['mercurio', 'Bolivia', 'minería aurífera', 'evidencia', 'mapa de brechas'],
    measurementTechnique: 'Catálogo de evidencia con revisión humana por campo',
    distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: base + '/catalog.json' }],
    hasPart: cat.fichas.map(function (r) {
      return { '@type': 'Dataset', identifier: r.id, name: r.titulo, datePublished: r.fecha_publicacion, citation: citar(r), sameAs: r.fuente,
        additionalProperty: [{ '@type': 'PropertyValue', name: 'matriz', value: r.matriz }, { '@type': 'PropertyValue', name: 'version', value: r.version }],
        'prov:wasAttributedTo': { '@type': 'Person', name: r.revisor } };
    }),
    additionalProperty: [{ '@type': 'PropertyValue', name: 'metadatos_ml', value: 'Basado en schema.org/Dataset. Pendiente de validar con mlcroissant antes de declararlo Croissant.' }]
  };
}

export function llmsTxt(base) {
  base = base || 'https://TU_DOMINIO';
  return [
    '# GoldEye Trace',
    '',
    '> Catálogo de estudios sobre mercurio en Bolivia. Solo las fichas publicadas y autorizadas aparecen en lectura. Un resultado vacío describe este catálogo indexado, no todo el territorio.',
    '',
    'Reglas para agentes: puedes leer, buscar y proponer; solo una persona revisora confirma campos y publica. No redistribuyas PDF de terceros. No pidas ni infieras datos individuales de salud. Cita con el campo cita_sugerida.',
    '',
    '## Conexión',
    '- [Servidor MCP](' + base + '/mcp): POST con JSON RPC, transporte Streamable HTTP, revisiones 2026-07-28 y 2025-11-25',
    '- [Catálogo en JSON LD](' + base + '/catalog.json): schema.org Dataset con proveniencia',
    '- [Reglas](' + base + '/reglas.md): reglas completas para agentes',
    '',
    '## Herramientas',
    '- buscar_estudios: busca fichas públicas por texto, ubicación, matriz y año de muestreo',
    '- listar_vacios: matrices sin ficha pública en este catálogo y vacíos confirmados',
    '- obtener_ficha: ficha con proveniencia y cita sugerida',
    '- proponer_candidato: registra un DOI o URL en una cola privada cuando PROPOSALS_DB está configurada',
    '- sugerir_valor: registra una sugerencia para una ficha pública; queda pendiente de firma',
    '',
    '## Opcional',
    '- Las herramientas confirmar_campo y publicar_ficha no están disponibles para agentes.',
    '- Los servicios de pago solo se anuncian cuando están configurados.'
  ].join('\n');
}

export function tablaPrecios() {
  return { gratis: ['buscar_estudios', 'listar_vacios', 'obtener_ficha', 'proponer_candidato', 'sugerir_valor', 'catalog.json', 'llms.txt'], de_pago: PRECIOS, credito_bs: CREDITO_BS, nota: 'Precios de ejemplo para validar con clientes. Leer la evidencia nunca se cobra.' };
}

// Procesa una peticion JSON RPC. Devuelve la respuesta, o null para notificaciones.
export function handleMcp(req, cat, ctx) {
  ctx = ctx || {};
  ctx.hoy = ctx.hoy || new Date().toISOString().slice(0, 10);
  cat = cat?.publico ? cat : proyeccionPublica(cat || catalogoInicial(), ctx.hoy);
  if (Array.isArray(req)) { var arr = req.map(function (r) { return handleMcp(r, cat, ctx); }).filter(function (x) { return x !== null; }); return arr.length ? arr : null; }
  if (!req || typeof req !== 'object' || req.jsonrpc !== '2.0' || typeof req.method !== 'string') { return err(req && req.id, -32600, 'Petición inválida: se espera JSON RPC 2.0 con method.'); }
  var id = req.id, p = req.params || {}, meta = p._meta || {};
  if (id === undefined) { return null; }
  var ver = meta['io.modelcontextprotocol/protocolVersion'];
  var ci = meta['io.modelcontextprotocol/clientInfo'];
  if (ci && ci.name && !ctx.cliente) { ctx.cliente = ci.name; }
  if (ver !== undefined && VERSIONES.indexOf(ver) < 0) { return err(id, -32022, 'Unsupported protocol version', { supported: VERSIONES, requested: ver }); }
  var m = req.method;
  if (m === 'initialize') {
    var rv = p.protocolVersion;
    return ok(id, { protocolVersion: VERSIONES.indexOf(rv) >= 0 ? rv : '2025-11-25', capabilities: { tools: { listChanged: false }, resources: {} }, serverInfo: SERVER_INFO, instructions: INSTRUCCIONES });
  }
  if (m === 'ping') { return ok(id, {}); }
  if (m === 'server/discover') {
    return ok(id, Object.assign({ resultType: 'complete', supportedVersions: VERSIONES, capabilities: { tools: {}, resources: {} }, _meta: META_SERVER, instructions: INSTRUCCIONES }, CACHE));
  }
  if (m === 'tools/list') {
    return ok(id, Object.assign({ resultType: 'complete', tools: herramientasDisponibles(ctx).map(function (t) { return { name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations }; }), _meta: META_SERVER }, CACHE));
  }
  if (m === 'tools/call') {
    var name = p.name, args = p.arguments || {};
    if (typeof name !== 'string') { return err(id, -32602, 'Falta params.name.'); }
    if (RESERVADAS.indexOf(name) >= 0) {
      return ok(id, { resultType: 'complete', isError: true, content: [{ type: 'text', text: 'Acción reservada: ' + name + ' exige la firma de una persona revisora. Un agente propone y la persona firma. Usa proponer_candidato o sugerir_valor y avisa a la persona revisora.' }], structuredContent: { codigo: 'firma_humana_requerida', herramientas_permitidas: herramientasDisponibles(ctx).map(function (t) { return t.name; }) }, _meta: META_SERVER });
    }
    var tool = herramientasDisponibles(ctx).filter(function (t) { return t.name === name; })[0];
    if (!tool) { return err(id, -32602, 'Unknown tool: ' + name); }
    var bad = validar(tool.inputSchema, args);
    if (bad) { return ok(id, { resultType: 'complete', isError: true, content: [{ type: 'text', text: bad }], structuredContent: { codigo: 'argumentos_invalidos' }, _meta: META_SERVER }); }
    var cb = cobrar(name, ctx);
    if (!cb.ok) {
      return ok(id, { resultType: 'complete', isError: true, content: [{ type: 'text', text: (cb.motivo === 'saldo_insuficiente' ? 'Saldo insuficiente: ' : 'Servicio de pago: ') + name + ' cuesta ' + cb.precio.creditos + ' créditos (Bs ' + cb.precio.bs + ') o USD ' + cb.precio.usd + ' por x402. Leer y proponer sigue siendo gratis.' }], structuredContent: { codigo: cb.motivo, herramienta: name, precio: cb.precio, opciones: opcionesPago(name, ctx) }, _meta: META_SERVER });
    }
    var r = ejecutar(name, args, cat, ctx);
    return ok(id, { resultType: 'complete', isError: !!r.error, content: [{ type: 'text', text: r.texto + '\n' + JSON.stringify(r.estructura) }], structuredContent: r.estructura, _meta: META_SERVER });
  }
  if (m === 'resources/list') {
    return ok(id, Object.assign({ resultType: 'complete', resources: [
      { uri: 'goldeye://catalogo', name: 'catalogo', title: 'Catálogo en JSON LD', description: 'schema.org Dataset con proveniencia', mimeType: 'application/json' },
      { uri: 'goldeye://reglas', name: 'reglas', title: 'Reglas para agentes', description: 'Que puede y que no puede hacer un agente', mimeType: 'text/markdown' },
      { uri: 'goldeye://precios', name: 'precios', title: 'Precios de servicios', description: 'Qué es gratis y qué se cobra', mimeType: 'application/json' }
    ], _meta: META_SERVER }, CACHE));
  }
  if (m === 'resources/read') {
    if (p.uri === 'goldeye://catalogo') { return ok(id, Object.assign({ resultType: 'complete', contents: [{ uri: p.uri, mimeType: 'application/json', text: JSON.stringify(catalogoJsonLd(cat, ctx.base)) }] }, NO_CACHE)); }
    if (p.uri === 'goldeye://reglas') { return ok(id, Object.assign({ resultType: 'complete', contents: [{ uri: p.uri, mimeType: 'text/markdown', text: REGLAS }] }, CACHE)); }
    if (p.uri === 'goldeye://precios') { return ok(id, Object.assign({ resultType: 'complete', contents: [{ uri: p.uri, mimeType: 'application/json', text: JSON.stringify(tablaPrecios()) }] }, CACHE)); }
    return err(id, -32602, 'Resource not found: ' + p.uri);
  }
  return err(id, -32601, 'Method not found: ' + m);
}
