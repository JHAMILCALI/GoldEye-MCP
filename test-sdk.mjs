// Prueba de interoperabilidad usando el cliente oficial, contra el Worker real.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import worker from './worker.js';

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) { chunks.push(chunk); }
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value && !['host', 'content-length', 'connection'].includes(key)) { headers.set(key, String(value)); }
    }
    const url = `http://127.0.0.1:${server.address().port}${request.url}`;
    const incoming = new Request(url, { method: request.method, headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.concat(chunks) });
    const outgoing = await worker.fetch(incoming, {});
    response.writeHead(outgoing.status, Object.fromEntries(outgoing.headers));
    response.end(Buffer.from(await outgoing.arrayBuffer()));
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);

try {
  for (const mode of ['auto', 'legacy']) {
    const client = new Client({ name: 'goldeye-sdk-test', version: '1.0.0' }, { versionNegotiation: { mode } });
    try {
      await client.connect(new StreamableHTTPClientTransport(url));
      const listed = await client.listTools();
      assert.ok(listed.tools.some((t) => t.name === 'buscar_estudios'));
      const search = await client.callTool({ name: 'buscar_estudios', arguments: { consulta: 'peces' } });
      assert.equal(search.structuredContent.total, 0);
      const proposal = await client.callTool({ name: 'proponer_candidato', arguments: { doi_o_url: '10.1000/prueba', motivo: 'Prueba de conexión' } });
      assert.equal(proposal.structuredContent.codigo, 'almacenamiento_no_configurado');
      console.log(`ok  SDK oficial conectado en modo ${mode}`);
    } finally {
      await client.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
