/**
 * Driver for the create1k/replace1k per-stage trace page (frameworks/keyed/re/trace.html).
 * Serves the js-framework-benchmark root statically, loads Chrome for Testing 155
 * (same binary as the official runner), runs the 6-variant A/B, prints a stage table.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/z/.npm-global/lib/node_modules/playwright');

const ROOT = '/home/z/my-project/js-framework-benchmark';
const PORT = 8123;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(ROOT, p);
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('nf');
  }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
  args: ['--js-flags=--expose-gc', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`http://localhost:${PORT}/frameworks/keyed/re/trace.html`, { waitUntil: 'load' });

const result = await page.evaluate(
  () =>
    new Promise((resolve, reject) => {
      const btn = document.getElementById('start');
      btn.click();
      const check = () => {
        const pre = document.getElementById('result');
        if (pre) resolve(JSON.parse(pre.textContent));
        else setTimeout(check, 500);
      };
      setTimeout(check, 1000);
      setTimeout(() => reject(new Error('trace timeout')), 480000);
    }),
);

await browser.close();
server.close();

/* ---------------- report ---------------- */

const order = ['A_cur', 'K_lean', 'J_fused', 'V_vanilla'];
const ops = ['create_all', 'replace_all'];

const stage = (v, op, k) => {
  const a = result[v]?.[op];
  if (!a) return '   —';
  const x = a.stages[k];
  return x == null ? '   —' : x.toFixed(3).padStart(7);
};
const tot = (v, op, k = 'med') => {
  const a = result[v]?.[op];
  if (!a) return '   —';
  return a.total[k].toFixed(3).padStart(7);
};

console.log('\n=== TOTAL handler (ms) — med / min / p90 ===');
console.log('variant      | create1k med | create1k min | replace1k med | replace1k min');
for (const v of order) {
  if (!result[v]) continue;
  console.log(
    v.padEnd(12), '|', tot(v, 'create_all'), '      |', tot(v, 'create_all', 'min'),
    '      |', tot(v, 'replace_all'), '        |', tot(v, 'replace_all', 'min'),
  );
}

console.log('\n=== STAGE medians (ms) ===');
const stageKeys = ['data', 'render', 'parse', 'map', 'insert', 'layout'];
for (const op of ops) {
  console.log(`\n-- ${op} --`);
  console.log('variant      ' + stageKeys.map((k) => k.padStart(8)).join(''));
  for (const v of order) {
    if (!result[v]) continue;
    console.log(v.padEnd(13) + stageKeys.map((k) => stage(v, op, k).padStart(8)).join(''));
  }
}

// speedup summary vs A_cur and V_vanilla
console.log('\n=== DESTROY A/B (clear, med ms) ===');
const clearAB = result['__clearAB'];
if (clearAB) {
  for (const k of Object.keys(clearAB)) {
    const { cur, swap } = clearAB[k];
    console.log(k.padEnd(6), `replaceChildren=${cur.toFixed(3)}ms`, ` cloneSwap=${swap.toFixed(3)}ms`, ` factor=${(cur / Math.max(swap, 0.001)).toFixed(1)}x`);
  }
}

console.log('\n=== FACTORS (total med) ===');
for (const op of ops) {
  const base = result['A_cur']?.[op]?.total.med;
  const van = result['V_vanilla']?.[op]?.total.med;
  console.log(`\n-- ${op} --  (lower is better)`);
  for (const v of order) {
    const t = result[v]?.[op]?.total.med;
    if (t == null) continue;
    const vsCur = base ? (t / base).toFixed(3) : '—';
    const vsVan = van ? (t / van).toFixed(3) : '—';
    console.log(v.padEnd(12), `vs A_cur: ${vsCur}`, ` vs vanilla: ${vsVan}`);
  }
}

process.exit(0);
