// Cliente real usando el SDK oficial de MCP.
// node cliente-ejemplo.mjs [URL_MCP] [--legacy]
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const endpoint = process.argv[2]?.startsWith('http') ? process.argv[2] : 'https://goldeye-trace-mcp.pinata-server.workers.dev/mcp';
const mode = process.argv.includes('--legacy') ? 'legacy' : 'auto';
const client = new Client({ name: 'goldeye-ejemplo', version: '1.0.0' }, { versionNegotiation: { mode } });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
  const tools = await client.listTools();
  console.log('Herramientas:', tools.tools.map((tool) => tool.name).join(', '));
  const search = await client.callTool({ name: 'buscar_estudios', arguments: { consulta: 'Kaka' } });
  console.log('Búsqueda:', JSON.stringify(search.structuredContent, null, 2));
  const gaps = await client.callTool({ name: 'listar_vacios', arguments: { matriz: 'pez' } });
  console.log('Cobertura:', JSON.stringify(gaps.structuredContent, null, 2));
} finally {
  await client.close();
}
