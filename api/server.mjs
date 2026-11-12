// API mínima de la prueba de Fase 0. Sin dependencias: `node server.mjs`.
// Cada informe se escribe en el log (línea "REPORT {...}") porque el disco de Render Free es efímero.
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.PORT) || 8080;
const REPORTS_KEY = process.env.REPORTS_KEY || '';
const REPORTS_FILE = process.env.REPORTS_FILE || 'reports.jsonl';
const MAX_BODY = 64 * 1024;

const reports = [];
const seen = new Set();

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    // Solo para medir el acceso directo (sin proxy). El sistema real no usará CORS (ADR-0005).
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
    ...headers,
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') return send(res, 204);

  if (req.method === 'GET' && url.pathname === '/api/ping') {
    return send(res, 200, { ok: true, ts: Date.now() });
  }

  if (req.method === 'POST' && url.pathname === '/api/report') {
    let report;
    try {
      report = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: 'invalid_body' });
    }
    if (!report || typeof report.id !== 'string') return send(res, 400, { error: 'missing_id' });
    if (seen.has(report.id)) return send(res, 200, { ok: true, duplicate: true });

    seen.add(report.id);
    report.receivedAt = new Date().toISOString();
    report.clientCountry = req.headers['cf-ipcountry'] || null;
    reports.push(report);
    console.log('REPORT ' + JSON.stringify(report));
    fs.appendFile(REPORTS_FILE, JSON.stringify(report) + '\n', () => {});
    return send(res, 201, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/reports') {
    if (!REPORTS_KEY || url.searchParams.get('key') !== REPORTS_KEY) return send(res, 404, { error: 'not_found' });
    return send(res, 200, reports);
  }

  send(res, 404, { error: 'not_found' });
});

// Recupera lo guardado si el disco sobrevivió a un reinicio.
try {
  for (const line of fs.readFileSync(REPORTS_FILE, 'utf8').split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (!seen.has(r.id)) { seen.add(r.id); reports.push(r); }
  }
} catch { /* sin archivo previo */ }

server.listen(PORT, () => console.log(`fase0 api escuchando en :${PORT}`));
