/**
 * Print min+gzip sizes for every @zhenre package dist bundle.
 * (gzip via node zlib — numbers match `gzip -9` closely enough for budgets.)
 */
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packages = [
  ['@zhenre/core', 're.min.js'],
  ['@zhenre/utils', 'utils.min.js'],
  ['@zhenre/animation', 'animation.min.js'],
  ['@zhenre/store', 'store.min.js'],
  ['@zhenre/router', 'router.min.js'],
  ['@zhenre/request', 'request.min.js'],
  ['@zhenre/message', 'message.min.js'],
  ['@zhenre/form', 'form.min.js'],
];

const kb = (n) => (n / 1024).toFixed(2) + 'KB';
const sizeOf = (name, file) => {
  const p = join(root, 'packages', name.split('/')[1], 'dist', file);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p);
  return { raw: raw.length, gz: gzipSync(raw, { level: 9 }).length };
};

console.log('package             min        min+gzip');
let ecoTotal = 0;
for (const [name, file] of packages) {
  const s = sizeOf(name, file);
  if (s === null) {
    console.log(name.padEnd(19) + '— not built —');
    continue;
  }
  if (name !== '@zhenre/core') ecoTotal += s.gz;
  console.log(
    name.padEnd(19),
    kb(s.raw).padEnd(10),
    kb(s.gz).padEnd(10),
  );
}
console.log('-'.repeat(42));
console.log('ecosystem total (min+gzip, excl. core): ' + kb(ecoTotal));
