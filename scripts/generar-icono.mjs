import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = readFileSync(new URL('../assets/goldeye-icon.svg', import.meta.url), 'utf8');
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng();
writeFileSync(new URL('../assets/goldeye-icon.png', import.meta.url), png);
writeFileSync(new URL('../brand-icon.js', import.meta.url),
  `// Generado por scripts/generar-icono.mjs; edita assets/goldeye-icon.svg.\n` +
  `export const ICON_SVG = ${JSON.stringify(svg)};\n` +
  `export const ICON_PNG_BASE64 = ${JSON.stringify(png.toString('base64'))};\n`);
console.log('Icono SVG y PNG de 512 px generados.');
