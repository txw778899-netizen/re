/**
 * In-page micro-profiler: isolates the remaining gaps (create1k, remove1k,
 * clear10k) and A/Bs implementation variants in the same browser session.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/z/.npm-global/lib/node_modules/playwright');

const server = spawn(process.execPath, ['bench/server.mjs'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch();
const page = await browser.newPage();

async function probe(url, fn, label) {
  await page.goto(url, { waitUntil: 'load' });
  const r = await page.evaluate(fn);
  console.log(`\n[${label}]`);
  for (const k of Object.keys(r)) console.log('  ' + k.padEnd(34) + r[k]);
}

const URL_RE = 'http://localhost:8080/bench/re/index.html';
const URL_VA = 'http://localhost:8080/bench/vanilla/index.html';

const removeProbe = async () => {
  // measure JUST the remove click, repeated with fresh 1k tables
  const t = async (sel) => {
    const t0 = performance.now();
    document.querySelector(sel).click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t0;
  };
  const rows = [];
  for (let i = 0; i < 60; i++) {
    await t('#run');
    rows.push(await t('#tbody tr:nth-child(501) td:nth-child(3)'));
  }
  rows.sort((a, b) => a - b);
  return { remove1k_median: rows[30].toFixed(3), remove1k_min: rows[0].toFixed(3) };
};

const clearProbe = async () => {
  const t = async (sel) => {
    const t0 = performance.now();
    document.querySelector(sel).click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t0;
  };
  const runs = [];
  for (let i = 0; i < 15; i++) {
    await t('#runlots');
    runs.push(await t('#clear'));
  }
  runs.sort((a, b) => a - b);
  return { clear10k_median: runs[7].toFixed(3), clear10k_min: runs[0].toFixed(3) };
};

const createProbe = async () => {
  const t = async (sel) => {
    const t0 = performance.now();
    document.querySelector(sel).click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t0;
  };
  await t('#run'); // warm template compile & JIT (framework equivalent of vanilla's eval-time template setup)
  const runs = [];
  for (let i = 0; i < 15; i++) {
    await t('#clear');
    runs.push(await t('#run'));
  }
  runs.sort((a, b) => a - b);
  return { create1k_warm_median: runs[7].toFixed(3), create1k_warm_min: runs[0].toFixed(3) };
};

const create10kProbe = async () => {
  const t = async (sel) => {
    const t0 = performance.now();
    document.querySelector(sel).click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t0;
  };
  const runs = [];
  for (let i = 0; i < 10; i++) {
    await t('#clear');
    runs.push(await t('#runlots'));
  }
  runs.sort((a, b) => a - b);
  return { create10k_warm_median: runs[5].toFixed(3), create10k_warm_min: runs[0].toFixed(3) };
};

await probe(URL_RE, removeProbe, 're    remove');
await probe(URL_VA, removeProbe, 'vanilla remove');
await probe(URL_RE, clearProbe, 're    clear');
await probe(URL_VA, clearProbe, 'vanilla clear');
await probe(URL_RE, createProbe, 're    create1k (warm)');
await probe(URL_VA, createProbe, 'vanilla create1k (warm)');
await probe(URL_RE, create10kProbe, 're    create10k (warm)');
await probe(URL_VA, create10kProbe, 'vanilla create10k (warm)');

await browser.close();
server.kill();
