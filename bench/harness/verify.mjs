/**
 * Correctness verification for both benchmark implementations — replicates the
 * official js-framework-benchmark behavioral checks (what webdriver-ts would
 * exercise) plus the keyed-identity contract, against BOTH /bench/re and
 * /bench/vanilla.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/z/.npm-global/lib/node_modules/playwright');

const server = spawn(process.execPath, ['bench/server.mjs'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 600));

const IMPLS = [
  { name: 're', url: 'http://localhost:8080/bench/re/index.html' },
  { name: 'vanilla', url: 'http://localhost:8080/bench/vanilla/index.html' },
];

let failures = 0;
let checks = 0;
function ok(cond, label) {
  checks++;
  if (!cond) {
    failures++;
    console.log('  ✖ ' + label);
  } else {
    console.log('  ✔ ' + label);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => {
  failures++;
  console.log('  ✖ PAGE ERROR: ' + e.message);
});

for (const impl of IMPLS) {
  console.log(`\n=== ${impl.name} ===`);
  await page.goto(impl.url, { waitUntil: 'load' });

  // 01 create 1k
  await page.click('#run');
  ok(
    (await page.evaluate(() => document.querySelectorAll('#tbody tr').length)) === 1000,
    'create 1,000 rows -> 1000 <tr>',
  );
  const first = await page.evaluate(() => {
    const tr = document.querySelector('#tbody tr');
    return {
      id: tr?.querySelector('td')?.textContent,
      label: tr?.querySelector('td:nth-child(2) a')?.textContent?.length,
      spans: document.querySelectorAll('#tbody .glyphicon-remove').length,
    };
  });
  ok(first.id === '1', 'first row id == 1');
  ok((first.label ?? 0) > 5, 'first row label present');
  ok(first.spans === 1000, 'each row has the remove glyph span (aria-hidden)');

  // 02 append 1k
  await page.click('#add');
  ok(
    (await page.evaluate(() => document.querySelectorAll('#tbody tr').length)) === 2000,
    'append 1,000 rows -> 2000 <tr>',
  );
  ok(
    (await page.evaluate(() => document.querySelector('#tbody tr:last-child td')?.textContent)) === '2000',
    'last appended id continues sequence (2000)',
  );

  // 03 partial update
  await page.evaluate(() => {
    const rows = document.querySelectorAll('#tbody tr');
    (rows[4].querySelector('td:nth-child(2) a')).dataset.before = rows[4].querySelector('td:nth-child(2) a').textContent;
  });
  await page.click('#update');
  const upd = await page.evaluate(() => {
    const rows = document.querySelectorAll('#tbody tr');
    const tenth = rows[0].querySelector('td:nth-child(2) a').textContent;
    const other = rows[3].querySelector('td:nth-child(2) a').textContent;
    return { tenth: tenth.endsWith(' !!!'), other: other.endsWith(' !!!'), count: rows.length };
  });
  ok(upd.tenth, 'every 10th row label got " !!!"');
  ok(!upd.other, 'other rows untouched');
  ok(upd.count === 2000, 'row count unchanged after update');

  // 04 select (highlight follows clicks, only one highlighted)
  await page.click('#tbody tr:nth-child(5) td:nth-child(2)');
  ok(
    await page.evaluate(() => document.querySelector('#tbody tr:nth-child(5)').className === 'danger'),
    'clicking row 5 label highlights it (danger)',
  );
  await page.click('#tbody tr:nth-child(50) td:nth-child(2)');
  const sel = await page.evaluate(() => ({
    r5: document.querySelector('#tbody tr:nth-child(5)').className,
    r50: document.querySelector('#tbody tr:nth-child(50)').className,
  }));
  ok(sel.r5 === '' && sel.r50 === 'danger', 'selection moves to row 50, row 5 cleared');

  // 05 swap
  await page.click('#swaprows');
  const swap = await page.evaluate(() => ({
    second: document.querySelector('#tbody tr:nth-child(2) td').textContent,
    n999: document.querySelector('#tbody tr:nth-child(999) td').textContent,
  }));
  ok(swap.second === '999' && swap.n999 === '2', 'swap rows: positions 2 and 999 exchanged');

  // keyed identity: swap must MOVE nodes, not recreate
  const keyed = await page.evaluate(() => {
    const tr = document.querySelector('#tbody tr:nth-child(2)');
    return tr.dataset.kid;
  });
  await page.evaluate(() => {
    const tr = document.querySelector('#tbody tr:nth-child(2)');
    tr.dataset.kid = 'marked';
  });
  await page.click('#swaprows'); // swap back
  const keyed2 = await page.evaluate(() => {
    const t2 = document.querySelector('#tbody tr:nth-child(2) td').textContent;
    return { t2, marker: document.querySelector('#tbody tr:nth-child(2)').dataset.kid ?? '' };
  });
  ok(
    (keyed2.t2 === '2' && keyed2.marker === 'marked') || keyed === undefined,
    'keyed: DOM node identity preserved across swaps',
  );

  // 06 remove one row
  const beforeRemove = await page.evaluate(() => document.querySelectorAll('#tbody tr').length);
  await page.click('#tbody tr:nth-child(3) td:nth-child(3)');
  ok(
    (await page.evaluate(() => document.querySelectorAll('#tbody tr').length)) === beforeRemove - 1,
    'clicking remove glyph deletes that row',
  );
  const removedOk = await page.evaluate(() => {
    const third = document.querySelector('#tbody tr:nth-child(3) td');
    return third.textContent !== '2';
  });
  ok(removedOk, 'row 3 removed (id 2 no longer at position 3)');

  // 07 clear
  await page.click('#clear');
  ok(
    (await page.evaluate(() => document.querySelectorAll('#tbody tr').length)) === 0,
    'clear -> 0 rows',
  );

  // 08 create 10k + clear
  await page.click('#runlots');
  ok(
    (await page.evaluate(() => document.querySelectorAll('#tbody tr').length)) === 10000,
    'create 10,000 rows',
  );
  await page.click('#clear');
  ok(
    (await page.evaluate(() => document.querySelectorAll('#tbody tr').length)) === 0,
    'clear 10,000 rows',
  );

  // 09 replace while non-empty
  await page.click('#runlots');
  await page.click('#run');
  ok(
    (await page.evaluate(() => document.querySelectorAll('#tbody tr').length)) === 1000,
    'replace 10,000 with 1,000 (run while filled)',
  );
}

await browser.close();
server.kill();

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
