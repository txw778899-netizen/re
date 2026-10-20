/** Behavior smoke for frameworks/keyed/re after the lean-path optimization. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/z/.npm-global/lib/node_modules/playwright');

const ROOT = '/home/z/my-project/js-framework-benchmark';
const PORT = 8125;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (p.endsWith('/')) p += 'index.html';
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(await readFile(join(ROOT, p)));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/frameworks/keyed/re/index.html`, { waitUntil: 'load' });

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok', name); }
  catch (e) { fail++; console.log('FAIL', name, '-', e.message); }
}
const click = (sel) => page.click(sel);
const rowCount = () => page.$$eval('#tbody tr', (r) => r.length);
const cell = (sel) => page.$eval(sel, (e) => e.innerText);

await t('run -> 1000 rows, ids 1..1000', async () => {
  await click('#run');
  await page.waitForFunction(() => document.querySelectorAll('#tbody tr').length === 1000);
  if ((await cell('#tbody tr:nth-child(1) td')) !== '1') throw new Error('first id');
  if ((await cell('#tbody tr:nth-child(1000) td')) !== '1000') throw new Error('last id');
});
await t('label structure intact (a>text, remove span present)', async () => {
  const label = await cell('#tbody tr:nth-child(7) td:nth-child(2) a');
  if (!label || label.length < 5) throw new Error('label empty');
  const span = await page.$('#tbody tr:nth-child(7) td:nth-child(3) a span');
  if (!span) throw new Error('remove span missing');
});
await t('run again (replace) -> fresh ids 1001..2000', async () => {
  await click('#run');
  await page.waitForFunction(() => document.querySelectorAll('#tbody tr').length === 1000);
  const first = await cell('#tbody tr:nth-child(1) td');
  if (first !== '1001') throw new Error('expected 1001, got ' + first);
  const last = await cell('#tbody tr:nth-child(1000) td');
  if (last !== '2000') throw new Error('expected 2000, got ' + last);
});
await t('select row 5 -> danger class, exclusive', async () => {
  await click('#tbody tr:nth-child(5) td:nth-child(2) a');
  const cls = await page.$eval('#tbody tr:nth-child(5)', (e) => e.className);
  if (!cls.includes('danger')) throw new Error('no danger');
  const n = await page.$$eval('#tbody tr.danger', (r) => r.length);
  if (n !== 1) throw new Error('danger count ' + n);
});
await t('update every 10th -> " !!!" on 991', async () => {
  await click('#update');
  await page.waitForFunction(() =>
    document.querySelector('#tbody tr:nth-child(991) td:nth-child(2) a').innerText.endsWith('!!!'));
});
await t('swap -> row2<->row998', async () => {
  await click('#swaprows');
  await page.waitForFunction(() =>
    document.querySelector('#tbody tr:nth-child(999) td').innerText === '1002');
});
await t('remove row 4 via span', async () => {
  const before = await rowCount();
  const id4 = await cell('#tbody tr:nth-child(4) td');
  await click('#tbody tr:nth-child(4) td:nth-child(3) a span');
  await page.waitForFunction((n) => document.querySelectorAll('#tbody tr').length === n, before - 1);
  const now4 = await cell('#tbody tr:nth-child(4) td');
  if (now4 === id4) throw new Error('row not removed');
});
await t('add -> +1000 rows continuing ids', async () => {
  const before = await rowCount();
  await click('#add');
  await page.waitForFunction((n) => document.querySelectorAll('#tbody tr').length === n + 1000, before);
  const last = await cell(`#tbody tr:nth-child(${before + 1000}) td`);
  if (last !== '3000') throw new Error('append id mismatch: ' + last);
});
await t('clear -> 0 rows', async () => {
  await click('#clear');
  await page.waitForFunction(() => document.querySelectorAll('#tbody tr').length === 0);
});
await t('no page errors', async () => {
  if (errors.length) throw new Error(errors.join(' | '));
});

await browser.close();
server.close();
console.log(`\nsmoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
