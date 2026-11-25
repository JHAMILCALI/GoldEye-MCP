// Cloudflare Worker: MCP gratuito de lectura y propuesta, más servicios de pago.
// Despliegue: npx wrangler deploy. Plan gratuito de Workers; KV opcional para guardar saldos de créditos.
import { handleMcp, catalogoInicial, proyeccionPublica, catalogoJsonLd, llmsTxt, REGLAS, PRECIOS, tablaPrecios } from './handler.js';
import { guardarPropuesta, listarPropuestas, revisarPropuesta } from './propuestas.js';
import { ICON_SVG, ICON_PNG_BASE64 } from './brand-icon.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Authorization, X-PAYMENT, X-Admin-Token',
  'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE',
  'Access-Control-Max-Age': '86400'
};
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra } });
const text = (body, type, cache = 'public, max-age=300') => new Response(body, { headers: { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': cache, ...CORS } });
const catalogoPublico = () => proyeccionPublica(catalogoInicial());
const errorHerramienta = (id, codigo, mensaje) => ({ jsonrpc: '2.0', id, result: {
  resultType: 'complete', isError: true, content: [{ type: 'text', text: mensaje }], structuredContent: { codigo }
} });

export async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function bearer(req) { const h = req.headers.get('Authorization') || ''; const m = h.match(/^Bearer\s+(\S{16,200})$/); return m ? m[1] : null; }

// Cuentas en KV: clave "k:<sha256 de la clave>" con { titular, creditos, plan }. Nunca se guarda la clave en claro.
async function cargarCuenta(env, key) {
  if (!key || !env || !env.CUENTAS) { return null; }
  const raw = await env.CUENTAS.get('k:' + await sha256(key));
  return raw ? { ...JSON.parse(raw), _h: await sha256(key) } : null;
}
async function guardarCuenta(env, c) { const { _h, ...rest } = c; await env.CUENTAS.put('k:' + _h, JSON.stringify(rest)); }

// x402: configuración desde variables. Apagado si falta X402_PAY_TO.
function x402cfg(env) {
  if (!env || !env.X402_PAY_TO) { return null; }
  return { red: env.X402_NETWORK || 'base', activo: env.X402_ASSET || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', pagar_a: env.X402_PAY_TO, facilitador: env.X402_FACILITATOR || 'https://x402.org/facilitator' };
}
export function requisitosX402(cfg, herramienta, recurso) {
  const pr = PRECIOS[herramienta];
  return { scheme: 'exact', network: cfg.red, maxAmountRequired: String(Math.round(pr.usd * 1e6)), resource: recurso, description: pr.que, mimeType: 'application/json', payTo: cfg.pagar_a, maxTimeoutSeconds: 60, asset: cfg.activo };
}
// Verifica y liquida con el facilitador. En modo demostración acepta el valor "demo".
async function verificarX402(env, cfg, header, req) {
  if (!header) { return null; }
  if (env.DEMO_PAGOS === '1' && header === 'demo') { return { valido: true, ref: 'demo' }; }
  if (!cfg) { return { valido: false }; }
  try {
    const payload = JSON.parse(atob(header));
    const body = { x402Version: 1, paymentPayload: payload, paymentRequirements: req };
    const v = await (await fetch(cfg.facilitador + '/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (!v.isValid) { return { valido: false, motivo: v.invalidReason }; }
    const st = await (await fetch(cfg.facilitador + '/settle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    return { valido: !!st.success, ref: st.transaction || null, respuesta: st };
  } catch (e) { return { valido: false, motivo: 'pago_ilegible' }; }
}

async function contexto(request, env, base, herramienta) {
  const ctx = { base, x402cfg: x402cfg(env), pagosDisponibles: !!env.CUENTAS || !!x402cfg(env) };
  const key = bearer(request);
  if (key) { ctx.cuenta = await cargarCuenta(env, key); if (!ctx.cuenta && env.DEMO_PAGOS === '1' && key === 'demo_goldeye_clave_000') { ctx.cuenta = { titular: 'demo', creditos: 20, plan: 'demo' }; } }
  const xp = request.headers.get('X-PAYMENT');
  if (xp && herramienta && PRECIOS[herramienta]) { ctx.x402 = await verificarX402(env, ctx.x402cfg, xp, ctx.x402cfg ? requisitosX402(ctx.x402cfg, herramienta, base + '/v1/' + herramienta) : null); }
  return ctx;
}
async function despuesDeCobrar(env, ctx) {
  if (ctx.cobro && ctx.cobro.via === 'creditos' && ctx.cuenta && ctx.cuenta._h && env.CUENTAS) { await guardarCuenta(env, ctx.cuenta); }
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const base = url.origin;
    const origin = request.headers.get('Origin');
    const allow = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : null;
    if (origin && allow && !allow.includes(origin)) { return json({ error: 'Origin no permitido' }, 403); }
    if (request.method === 'OPTIONS') { return new Response(null, { status: 204, headers: CORS }); }
    if (url.pathname === '/icon.svg' || url.pathname === '/favicon.svg') { return text(ICON_SVG, 'image/svg+xml', 'public, max-age=86400'); }
    if (url.pathname === '/icon.png') {
      const bytes = Uint8Array.from(atob(ICON_PNG_BASE64), (char) => char.charCodeAt(0));
      return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', ...CORS } });
    }
    if (url.pathname === '/llms.txt') { return text(llmsTxt(base), 'text/plain'); }
    if (url.pathname === '/reglas.md') { return text(REGLAS, 'text/markdown'); }
    if (url.pathname === '/catalog.json') { return text(JSON.stringify(catalogoJsonLd(catalogoPublico(), base)), 'application/ld+json', 'no-store'); }
    if (url.pathname === '/v1/precios') { const t = tablaPrecios(); t.x402 = !!x402cfg(env); t.servicios_activos = !!env.CUENTAS || !!x402cfg(env); t.recarga = 'Pago con QR interbancario a la cuenta del proyecto; los créditos se acreditan al confirmar el depósito y se emite factura.'; return json(t); }

    // API REST de servicios de pago (misma lógica que las herramientas MCP)
    const m = url.pathname.match(/^\/v1\/(generar_informe|exportar_anexo)$/);
    if (m) {
      if (request.method !== 'POST') { return json({ error: 'Usa POST' }, 405); }
      if (!env.CUENTAS && !x402cfg(env)) { return json({ error: 'Servicio no disponible todavía' }, 503); }
      let args = {};
      try { const t = await request.text(); args = t ? JSON.parse(t) : {}; } catch (e) { return json({ error: 'JSON inválido' }, 400); }
      const ctx = await contexto(request, env, base, m[1]);
      const res = handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: m[1], arguments: args } }, catalogoPublico(), ctx);
      const r = res.result;
      if (r && r.isError && ['pago_requerido', 'saldo_insuficiente'].includes(r.structuredContent.codigo)) {
        const body = { ...r.structuredContent };
        if (ctx.x402cfg) { body.x402Version = 1; body.accepts = [requisitosX402(ctx.x402cfg, m[1], base + url.pathname)]; body.error = ctx.x402 && !ctx.x402.valido ? 'pago_invalido' : 'X-PAYMENT requerido'; }
        return json(body, 402);
      }
      if (r && r.isError) { return json(r.structuredContent, 400); }
      await despuesDeCobrar(env, ctx);
      const extra = ctx.x402 && ctx.x402.respuesta ? { 'X-PAYMENT-RESPONSE': btoa(JSON.stringify(ctx.x402.respuesta)) } : {};
      return json(r.structuredContent, 200, extra);
    }

    // Administración: emitir claves y acreditar recargas confirmadas por QR. Solo con ADMIN_TOKEN.
    if (url.pathname.startsWith('/v1/admin/')) {
      if (!env.ADMIN_TOKEN || request.headers.get('X-Admin-Token') !== env.ADMIN_TOKEN) { return json({ error: 'No autorizado' }, 401); }
      if (url.pathname === '/v1/admin/propuestas' && request.method === 'GET') {
        if (!env.PROPOSALS_DB) { return json({ error: 'Falta PROPOSALS_DB' }, 503); }
        return json({ propuestas: await listarPropuestas(env.PROPOSALS_DB) });
      }
      const revision = url.pathname.match(/^\/v1\/admin\/propuestas\/([a-z0-9_]+)$/);
      if (revision && request.method === 'PATCH') {
        if (!env.PROPOSALS_DB) { return json({ error: 'Falta PROPOSALS_DB' }, 503); }
        let body;
        try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
        if (!['aceptada', 'rechazada'].includes(body.estado) || typeof body.revisor !== 'string' || !body.revisor.trim()) {
          return json({ error: 'Se requieren estado (aceptada o rechazada) y revisor' }, 400);
        }
        const reviewed = await revisarPropuesta(env.PROPOSALS_DB, revision[1], body.estado, body.revisor.trim());
        return reviewed ? json(reviewed) : json({ error: 'Propuesta no encontrada o ya revisada' }, 409);
      }
      if (!env.CUENTAS) { return json({ error: 'Falta el espacio KV CUENTAS' }, 500); }
      let b = {}; try { b = await request.json(); } catch (e) { return json({ error: 'JSON inválido' }, 400); }
      if (url.pathname === '/v1/admin/claves' && request.method === 'POST') {
        const key = 'gt_' + crypto.randomUUID().replace(/-/g, '');
        const c = { titular: String(b.titular || 'sin nombre').slice(0, 80), creditos: 0, plan: 'prepago', _h: await sha256(key) };
        await guardarCuenta(env, c);
        return json({ clave: key, aviso: 'Entrega esta clave una sola vez; solo se guarda su hash.' }, 201);
      }
      if (url.pathname === '/v1/admin/recargas' && request.method === 'POST') {
        const n = Number(b.creditos);
        if (!b.clave || !Number.isInteger(n) || n <= 0 || n > 100000 || !b.referencia_qr) { return json({ error: 'Faltan clave, creditos enteros o referencia_qr' }, 400); }
        const c = await cargarCuenta(env, b.clave);
        if (!c) { return json({ error: 'Clave desconocida' }, 404); }
        c.creditos += n;
        c.ultima_recarga = { creditos: n, referencia_qr: String(b.referencia_qr).slice(0, 60), fecha: new Date().toISOString().slice(0, 10) };
        await guardarCuenta(env, c);
        return json({ ok: true, creditos: c.creditos });
      }
      return json({ error: 'Ruta desconocida' }, 404);
    }

    if (url.pathname === '/mcp') {
      if (request.method !== 'POST') { return json({ error: 'Usa POST' }, 405, { Allow: 'POST, OPTIONS' }); }
      const raw = await request.text();
      if (raw.length > 65536) { return json({ error: 'Cuerpo demasiado grande' }, 413); }
      let body;
      try { body = JSON.parse(raw); } catch (e) { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalido' } }, 400); }
      if (Array.isArray(body)) { return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'MCP no acepta lotes JSON RPC' } }, 400); }
      const first = body;
      const hv = request.headers.get('MCP-Protocol-Version');
      const hm = request.headers.get('Mcp-Method');
      const hn = request.headers.get('Mcp-Name');
      const bv = first && first.params && first.params._meta && first.params._meta['io.modelcontextprotocol/protocolVersion'];
      if ((hv && bv && hv !== bv) || (hm && first && first.method && hm !== first.method) ||
          (hn && first?.method === 'tools/call' && hn !== first.params?.name)) {
        return json({ jsonrpc: '2.0', id: (first && first.id) ?? null, error: { code: -32020, message: 'Header mismatch: los encabezados no coinciden con el cuerpo' } }, 400);
      }
      if ((hv === '2026-07-28' || bv === '2026-07-28') && (!hm || (first?.method === 'tools/call' && !hn))) {
        return json({ jsonrpc: '2.0', id: first?.id ?? null, error: { code: -32020, message: 'Faltan Mcp-Method o Mcp-Name' } }, 400);
      }
      const tool = first && first.method === 'tools/call' && first.params ? first.params.name : null;
      const ctx = await contexto(request, env, base, tool);
      let res = handleMcp(body, catalogoPublico(), ctx);
      if (res?.result && !res.result.isError && ['proponer_candidato', 'sugerir_valor'].includes(tool)) {
        if (!env.PROPOSALS_DB) {
          res = errorHerramienta(first.id, 'almacenamiento_no_configurado', 'La cola de propuestas no está configurada. Nada fue guardado.');
        } else {
          try {
            const tipo = tool === 'proponer_candidato' ? 'candidato' : 'sugerencia';
            const contenido = tipo === 'candidato' ? res.result.structuredContent.propuesta : res.result.structuredContent.sugerencia;
            const guardada = await guardarPropuesta(env.PROPOSALS_DB, tipo, contenido, ctx.cliente || 'agente externo');
            res.result.structuredContent = { [tipo === 'candidato' ? 'propuesta' : 'sugerencia']: guardada };
            res.result.content = [{ type: 'text', text: JSON.stringify(res.result.structuredContent) }];
          } catch (error) {
            console.error('Error al guardar propuesta', error);
            res = errorHerramienta(first.id, 'almacenamiento_fallido', 'No se pudo guardar la propuesta. Nada fue confirmado.');
          }
        }
      }
      await despuesDeCobrar(env, ctx);
      if (res === null) { return new Response(null, { status: 202, headers: CORS }); }
      const bad = !Array.isArray(res) && res.error && (res.error.code === -32022 || res.error.code === -32020);
      return json(res, bad ? 400 : 200);
    }
    return text('GoldEye Trace MCP. Lee /llms.txt para empezar.', 'text/plain');
  }
};
