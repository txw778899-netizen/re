/** Compare before/after official runner results, vanilla-anchored per session. */
const fs = require('node:fs');
const R = '/home/z/my-project/js-framework-benchmark/webdriver-ts/results';
const B = '/home/z/my-project/js-framework-benchmark/webdriver-ts/results-before-opt';

const OPS = [
  ['01_run1k', '01 create1k'],
  ['02_replace1k', '02 replace1k'],
  ['03_update10th1k_x16', '03 update10th'],
  ['04_select1k', '04 select1k'],
  ['05_swap1k', '05 swap1k'],
  ['06_remove-one-1k', '06 remove'],
  ['07_create10k', '07 create10k'],
  ['08_create1k-after1k_x2', '08 append10k'],
  ['09_clear1k_x8', '09 clear10k'],
];

function load(dir, fw, op) {
  const f = `${dir}/${fw}-keyed_${op}.json`;
  if (!fs.existsSync(f)) return null;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = d.values?.total;
  if (!v) return null;
  const script = d.values.script;
  return {
    med: v.median,
    min: v.min,
    scriptMed: script?.median,
    scriptMin: script?.min,
    paintMed: d.values.paint?.median,
  };
}
const geo = (xs) => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length);

const row = (label, before, after) => {
  const cells = [
    before ? before.med.toFixed(1) : '—',
    before?.scriptMed != null ? before.scriptMed.toFixed(2) : '—',
    after ? after.med.toFixed(1) : '—',
    after?.scriptMed != null ? after.scriptMed.toFixed(2) : '—',
  ];
  console.log(
    label.padEnd(14),
    cells[0].padStart(7), cells[1].padStart(7), ' | ',
    cells[2].padStart(7), cells[3].padStart(7),
  );
};

console.log('=== ABSOLUTE MEDIANS (ms) — before | after ===');
console.log('op            total  script |  total  script   (vanilla)');
const vanAfter = {};
const vanBefore = {};
for (const [op, label] of OPS) {
  vanAfter[op] = load(R, 'vanillajs', op);
  vanBefore[op] = load(B, 'vanillajs', op);
  row('va ' + label, vanBefore[op], vanAfter[op]);
}
console.log('op            total  script |  total  script   (@re)');
const reAfter = {};
const reBefore = {};
for (const [op, label] of OPS) {
  reAfter[op] = load(R, 're-v0.1.0', op);
  reBefore[op] = load(B, 're-v0.1.0', op);
  row('re ' + label, reBefore[op], reAfter[op]);
}

console.log('\n=== FACTOR @re/vanilla (median-total) — before -> after ===');
const fBefore = [];
const fAfter = [];
for (const [op, label] of OPS) {
  const fb = reBefore[op] && vanBefore[op] ? reBefore[op].med / vanBefore[op].med : null;
  const fa = reAfter[op] && vanAfter[op] ? reAfter[op].med / vanAfter[op].med : null;
  if (fb) fBefore.push(fb);
  if (fa) fAfter.push(fa);
  console.log(
    label.padEnd(14),
    fb ? fb.toFixed(3).padStart(7) : '   —   ',
    '->',
    fa ? fa.toFixed(3).padStart(7) : '   —   ',
    fa && fb ? `  (${((fb - fa) * 100).toFixed(1)} pp)` : '',
  );
}
if (fBefore.length === fAfter.length && fBefore.length > 0) {
  console.log('GEOMEAN:', geo(fBefore).toFixed(4), '->', geo(fAfter).toFixed(4));
}

console.log('\n=== SCRIPT-ONLY FACTOR @re/vanilla (median-script) — before -> after ===');
const sAfter = [];
for (const [op, label] of OPS) {
  const sb = reBefore[op] && vanBefore[op] && reBefore[op].scriptMed && vanBefore[op].scriptMed
    ? reBefore[op].scriptMed / vanBefore[op].scriptMed : null;
  const sa = reAfter[op] && vanAfter[op] && reAfter[op].scriptMed && vanAfter[op].scriptMed
    ? reAfter[op].scriptMed / vanAfter[op].scriptMed : null;
  if (sa) sAfter.push(sa);
  console.log(
    label.padEnd(14),
    sb ? sb.toFixed(3).padStart(7) : '   —   ',
    '->',
    sa ? sa.toFixed(3).padStart(7) : '   —   ',
  );
}
if (sAfter.length) console.log('GEOMEAN(script):', geo(sAfter).toFixed(4));

for (const [m, dir, fwA, fwB] of [
  ['ready', R, 're-v0.1.0', 'vanillajs'],
  ['run', R, 're-v0.1.0', 'vanillajs'],
]) {
  const a = load(R, fwA, `2${m === 'ready' ? 1 : 2}_dummy`);
  void a;
}
const mem = (dir, fw, op) => {
  const f = `${dir}/${fw}-keyed_${op}.json`;
  if (!fs.existsSync(f)) return null;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  return d.values?.total?.median ?? d.values?.total; // mem values structure
};
console.log('\n=== MEMORY (MB, after run) ===');
for (const op of ['21_ready-memory', '22_run-memory', '25_create-clear5-memory']) {
  const va = mem(R, 'vanillajs', op);
  const ra = mem(R, 're-v0.1.0', op);
  const vb = mem(B, 'vanillajs', op);
  const rb = mem(B, 're-v0.1.0', op);
  console.log(op.padEnd(26), 'before: re', rb ?? '—', 'vanilla', vb ?? '—', ' | after: re', ra ?? '—', 'vanilla', va ?? '—');
}
