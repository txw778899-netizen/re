/**
 * Full local benchmark runner — measures @re vs the official vanilla baseline
 * on the same machine/browser with the official operation set.
 *
 * Methodology (mirrors js-framework-benchmark's webdriver-ts):
 *   - duration includes rendering: click -> double requestAnimationFrame
 *   - warm ops: fresh page, setup click, 5 warmup clicks, then measured clicks
 *     on the SAME page (state evolves exactly like the official runner)
 *   - no-warmup ops (create/append/clear/remove): fresh page per measured
 *     iteration, per official spec ("no warmup" = first-op-after-load)
 *   - sequential single-page measurement (same-process pages would share the
 *     main thread and interfere); implementation order alternates per round
 *   - memory via CDP Performance.getMetrics after forced GC
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/z/.npm-global/lib/node_modules/playwright');

const ROUNDS = Number(process.env.ROUNDS ?? 2);

const server = spawn(process.execPath, ['bench/server.mjs'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 600));

const IMPLS = {
  re: 'http://localhost:8080/bench/re/index.html',
  vanilla: 'http://localhost:8080/bench/vanilla/index.html',
};

const INIT = `
window.__t = async (sel) => {
  const t0 = performance.now();
  (typeof sel === 'string' ? document.querySelector(sel) : sel).click();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return performance.now() - t0;
};
`;

const OPS = [
  { id: '01_run1k', warm: 0, iters: 10, fresh: true, act: `__t('#run')` },
  { id: '02_replace1k', warm: 5, iters: 20, fresh: false, pre: `__t('#run')`, act: `__t('#run')` },
  { id: '03_update10th1k', warm: 5, iters: 20, fresh: false, pre: `__t('#run')`, act: `__t('#update')` },
  { id: '04_select1k', warm: 5, iters: 20, fresh: false, pre: `__t('#run')`, act: `__t('#tbody tr:nth-child(501) td:nth-child(2)')` },
  { id: '05_swap1k', warm: 5, iters: 20, fresh: false, pre: `__t('#run')`, act: `__t('#swaprows')` },
  { id: '06_remove1k', warm: 0, iters: 12, fresh: true, pre: `__t('#run')`, act: `__t('#tbody tr:nth-child(501) td:nth-child(3)')` },
  { id: '07_run10k', warm: 0, iters: 7, fresh: true, act: `__t('#runlots')` },
  { id: '08_append10k', warm: 0, iters: 7, fresh: true, pre: `__t('#runlots')`, act: `__t('#add')` },
  { id: '09_clear10k', warm: 0, iters: 7, fresh: true, pre: `__t('#runlots')`, act: `__t('#clear')` },
];

const results = { re: {}, vanilla: {} };
for (const op of OPS) {
  results.re[op.id] = [];
  results.vanilla[op.id] = [];
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(INIT);

async function measureOp(impl, op) {
  if (op.fresh) {
    for (let i = 0; i < op.iters; i++) {
      await page.goto(IMPLS[impl], { waitUntil: 'load' });
      if (op.pre) await page.evaluate(op.pre);
      const ms = await page.evaluate(op.act);
      results[impl][op.id].push(ms);
    }
  } else {
    await page.goto(IMPLS[impl], { waitUntil: 'load' });
    if (op.pre) await page.evaluate(op.pre);
    for (let w = 0; w < op.warm; w++) await page.evaluate(op.act);
    for (let i = 0; i < op.iters; i++) {
      const ms = await page.evaluate(op.act);
      results[impl][op.id].push(ms);
    }
  }
}

for (let round = 0; round < ROUNDS; round++) {
  const order = round % 2 === 0 ? ['vanilla', 're'] : ['re', 'vanilla'];
  console.log(`Round ${round + 1}: ${order.join(' -> ')}`);
  for (const op of OPS) {
    for (const impl of order) await measureOp(impl, op);
    console.log(`  ${op.id} done (${results.re[op.id].length} iters/impl)`);
  }
}

/* ---------------- memory (CDP + forced GC) ---------------- */
console.log('Memory metrics');
async function mem(impl, seq) {
  await page.goto(IMPLS[impl], { waitUntil: 'load' });
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  async function heap() {
    await client.send('HeapProfiler.collectGarbage');
    const m = await client.send('Performance.getMetrics');
    return m.metrics.find((x) => x.name === 'JSHeapUsedSize').value / 1024 / 1024;
  }
  const out = {};
  out['10_ready-memory'] = await heap();
  for (const [label, clicks] of seq) {
    for (const c of clicks) await page.evaluate(`__t(${JSON.stringify(c)})`);
    out[label] = await heap();
  }
  await client.detach();
  return out;
}

const memSeq = [
  ['21_run-memory', ['#run']],
  ['23_update5k-memory', ['#update', '#update', '#update', '#update', '#update']],
];
const memResults = {};
for (const impl of ['vanilla', 're']) {
  memResults[impl] = {};
  memResults[impl]['10_ready-memory'] = (await mem(impl, memSeq))['10_ready-memory'];
  const m1 = await mem(impl, memSeq);
  memResults[impl]['21_run-memory'] = m1['21_run-memory'];
  memResults[impl]['23_update5k-memory'] = m1['23_update5k-memory'];
  // replace memory: 5x create 1k
  await page.goto(IMPLS[impl], { waitUntil: 'load' });
  const c = await page.context().newCDPSession(page);
  await c.send('Performance.enable');
  for (let i = 0; i < 5; i++) await page.evaluate(`__t('#run')`);
  await c.send('HeapProfiler.collectGarbage');
  const m2 = await c.send('Performance.getMetrics');
  memResults[impl]['22_replace5k-memory'] = m2.metrics.find((x) => x.name === 'JSHeapUsedSize').value / 1024 / 1024;
  await c.detach();
  // repeated clear memory: 5x (create + clear)
  await page.goto(IMPLS[impl], { waitUntil: 'load' });
  const c3 = await page.context().newCDPSession(page);
  await c3.send('Performance.enable');
  for (let i = 0; i < 5; i++) {
    await page.evaluate(`__t('#run')`);
    await page.evaluate(`__t('#clear')`);
  }
  await c3.send('HeapProfiler.collectGarbage');
  const m3 = await c3.send('Performance.getMetrics');
  memResults[impl]['26_repeat-clear5k-memory'] = m3.metrics.find((x) => x.name === 'JSHeapUsedSize').value / 1024 / 1024;
  await c3.detach();
  console.log(`  ${impl}: ` + JSON.stringify(Object.fromEntries(Object.entries(memResults[impl]).map(([k, v]) => [k, v.toFixed(2)]))));
}

await browser.close();
server.kill();

mkdirSync('bench/results', { recursive: true });
const meta = {
  date: new Date().toISOString(),
  node: process.version,
  browser: 'chromium (playwright bundled)',
  rounds: ROUNDS,
  methodology:
    'sequential single-page measurement, impl order alternates per round; warm ops: 5 warmup + measured on same page; fresh ops: reload per iteration; timing = click -> double rAF; median reported',
  opIters: Object.fromEntries(OPS.map((o) => [o.id, { warm: o.warm, iters: o.iters * ROUNDS }])),
};
writeFileSync(
  'bench/results/results.json',
  JSON.stringify({ meta, durations: results, memory: memResults }, null, 2),
);
console.log('\nSaved bench/results/results.json');
