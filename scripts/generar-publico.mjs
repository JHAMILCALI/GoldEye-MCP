import { writeFileSync } from 'node:fs';
import { catalogoInicial, catalogoJsonLd, llmsTxt } from '../handler.js';

const base = process.argv[2] || 'https://goldeye-trace-mcp.pinata-server.workers.dev';
writeFileSync(new URL('../catalog.json', import.meta.url), JSON.stringify(catalogoJsonLd(catalogoInicial(), base), null, 2) + '\n');
writeFileSync(new URL('../llms.txt', import.meta.url), llmsTxt(base) + '\n');
console.log('Archivos públicos generados desde fichas autorizadas.');
