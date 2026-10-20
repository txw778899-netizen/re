/** Statistics + comparison for bench/results/results.json */
import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('bench/results/results.json', 'utf8'));
const { durations, memory } = data;

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const geomean = (a) => Math.exp(mean(a.map(Math.log)));

const OPS = Object.keys(durations.re);

const rows = [];
for (const op of OPS) {
  const vr = durations.vanilla[op];
  const rr = durations.re[op];
  const vm = median(vr);
  const rm = median(rr);
  rows.push({
    op,
    vanillaMedian: vm,
    reMedian: rm,
    vanillaMean: mean(vr),
    reMean: mean(rr),
    reMin: Math.min(...rr),
    vanillaMin: Math.min(...vr),
    factor: rm / vm,
  });
}

const geoFactor = geomean(rows.map((r) => r.factor));

console.log('op                 vanilla(ms)   re(ms)    factor');
for (const r of rows) {
  console.log(
    r.op.padEnd(18) +
      r.vanillaMedian.toFixed(2).padStart(8) +
      r.reMedian.toFixed(2).padStart(10) +
      r.factor.toFixed(3).padStart(10),
  );
}
console.log('\ngeometric mean of factors: ' + geoFactor.toFixed(4));

console.log('\nmemory (MB):');
for (const k of Object.keys(memory.vanilla)) {
  console.log(
    k.padEnd(30) +
      memory.vanilla[k].toFixed(2).padStart(8) +
      memory.re[k].toFixed(2).padStart(10) +
      (memory.re[k] / memory.vanilla[k]).toFixed(2).padStart(8) + 'x',
  );
}

writeFileSync(
  'bench/results/summary.json',
  JSON.stringify({ rows, geoFactor, memory }, null, 2),
);
console.log('\nSaved bench/results/summary.json');
