// Resume los informes de la prueba por proveedor y tipo de red.
// Uso: node analyze.mjs reports.json     (JSON de /api/reports, o .jsonl con líneas "REPORT {...}" del log)
import fs from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('Uso: node analyze.mjs <reports.json|log.txt>'); process.exit(1); }

const raw = fs.readFileSync(file, 'utf8').trim();
const reports = raw.startsWith('[')
  ? JSON.parse(raw)
  : raw.split('\n').map((l) => l.slice(l.indexOf('{'))).filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));

const runs = reports.filter((r) => r.type === 'run');
const offline = reports.filter((r) => r.type === 'offline');
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

const groups = new Map();
for (const r of runs) {
  const key = `${r.provider} | ${r.form.network}${r.form.vpn === 'si' ? ' (VPN)' : ''}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const rows = [...groups.entries()].sort().map(([key, rs]) => {
  const proxy = rs.flatMap((r) => r.tests.proxyPing?.samples ?? []);
  return {
    'proveedor | red': key,
    pruebas: rs.length,
    personas: new Set(rs.map((r) => r.form.alias)).size,
    'carga pág. (ms, mediana)': median(rs.map((r) => r.tests.navigation?.loadMs)),
    'descarga (KB/s, mediana)': median(rs.map((r) => r.tests.download?.kbps)),
    'proxy ok %': proxy.length ? Math.round((100 * proxy.filter((s) => s.ok).length) / proxy.length) : null,
    'proxy ms (mediana)': median(proxy.filter((s) => s.ok).map((s) => s.ms)),
    'directa ms (mediana)': median(rs.map((r) => r.tests.directPing?.medianMs)),
    ...Object.fromEntries(
      [...new Set(rs.flatMap((r) => Object.keys(r.tests.apis ?? {})))].flatMap((name) => [
        [`${name} proxy ms`, median(rs.flatMap((r) => (r.tests.apis?.[name]?.proxyPing.samples ?? []).filter((s) => s.ok).map((s) => s.ms)))],
        [`${name} directa ms`, median(rs.map((r) => r.tests.apis?.[name]?.directPing.medianMs))],
      ])
    ),
    'API directa ok': rs.filter((r) => r.tests.directPing?.okCount > 0).length + '/' + rs.length,
    'YouTube ok': rs.filter((r) => r.tests.youtubeThumb?.ok).length + '/' + rs.length,
    'offline ok': offline.filter((o) => rs.some((r) => r.id === o.runId)).length + '/' + rs.length,
  };
});
console.table(rows);

// Accesibilidad cruzada: cada página sondea a todos los candidatos.
const cross = new Map();
for (const r of runs) for (const c of r.tests.candidates ?? []) {
  const key = `${c.name} | ${r.form.network}`;
  const v = cross.get(key) ?? { ok: 0, total: 0 };
  v.total++; if (c.ok) v.ok++;
  cross.set(key, v);
}
console.log('\nAccesibilidad de cada candidato (sondeo con imagen desde cualquier página):');
console.table([...cross.entries()].sort().map(([k, v]) => ({ 'candidato | red': k, ok: `${v.ok}/${v.total}` })));
