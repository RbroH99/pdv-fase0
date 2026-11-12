// Genera una versión del sitio de prueba por proveedor en dist/<proveedor>/.
// Uso: node build.mjs            (lee config.json)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const api = config.apiUrl.replace(/\/$/, '');
const dist = path.join(root, 'dist');

// PNG transparente de 1×1 para sondear hosts sin CORS.
const PROBE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
// 150 KB aleatorios: no se comprimen, así se mide la transferencia real.
const PAYLOAD = crypto.randomBytes(150 * 1024);

function writeSite(dir, provider) {
  fs.cpSync(path.join(root, 'site'), dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'payload.bin'), PAYLOAD);
  fs.writeFileSync(path.join(dir, 'probe.png'), PROBE_PNG);
  fs.writeFileSync(
    path.join(dir, 'config.js'),
    `window.FASE0_CONFIG = ${JSON.stringify({ ...config, apiUrl: api, provider }, null, 2)};\n`
  );
}

// La cáscara siempre se revalida (si no, la CDN la sirve vieja hasta 5 min) y las mediciones nunca se cachean.
const HEADERS = ['/sw.js', '/config.js', '/index.html', '/'].map((p) => `${p}\n  Cache-Control: no-cache\n`).join('')
  + '/assets/*\n  Cache-Control: no-store\n';

fs.rmSync(dist, { recursive: true, force: true });

// Netlify: proxy con _redirects (status 200 = reescritura, no redirección).
const netlify = path.join(dist, 'netlify');
writeSite(netlify, 'netlify');
fs.writeFileSync(path.join(netlify, '_redirects'), `/api/*  ${api}/api/:splat  200!\n`);
fs.writeFileSync(path.join(netlify, '_headers'), HEADERS);

// Cloudflare Pages: _redirects no admite destinos externos con 200, así que el proxy es una Pages Function.
const cf = path.join(dist, 'cloudflare');
writeSite(path.join(cf, 'public'), 'cloudflare');
fs.writeFileSync(path.join(cf, 'public', '_headers'), HEADERS);
fs.mkdirSync(path.join(cf, 'functions', 'api'), { recursive: true });
fs.writeFileSync(
  path.join(cf, 'functions', 'api', '[[path]].js'),
  `const API = ${JSON.stringify(api)};

export async function onRequest({ request }) {
  const url = new URL(request.url);
  return fetch(new Request(API + url.pathname + url.search, request));
}
`
);

// Render Static Site: la reescritura /api/* se configura en el panel o en render.yaml (ver README).
writeSite(path.join(dist, 'render'), 'render');

console.log(`Sitios generados en ${dist} con API ${api}`);
