/**
 * 把 @re 的官方 runner 实测系数放进公开榜单排位。
 *
 * 口径说明（关键）：
 * - 因子 = 框架中位数 / **同一数据来源**的 vanillajs-keyed 中位数。
 * - 公开榜单：js-framework-benchmark/webdriver-ts/results.json（krausest 硬件），
 *   因子除以该数据集内的 vanillajs-keyed —— 忠实复现官方表格口径。
 * - @re / solid：scripts/jsfb_raw 本沙箱同会话配对原始数据，
 *   因子除以**本会话**的 vanillajs-keyed（同会话消除硬件与负载漂移）。
 * - 绝对毫秒跨硬件不可比；相对因子跨机器可比（有 paint/script 比例差异的固有误差）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PUB = process.argv[2] ?? '../webdriver-ts/results.json'; // 官方仓库 webdriver-ts/results.json
const RAW = process.argv[3] ?? './official-raw'; // 本地官方 runner 原始 JSON 目录

const CPU = [
  '01_run1k', '02_replace1k', '03_update10th1k_x16', '04_select1k',
  '05_swap1k', '06_remove-one-1k', '07_create10k',
  '08_create1k-after1k_x2', '09_clear1k_x8',
];
const SHORT = {
  '01_run1k': 'create1k', '02_replace1k': 'replace', '03_update10th1k_x16': 'update',
  '04_select1k': 'select', '05_swap1k': 'swap', '06_remove-one-1k': 'remove',
  '07_create10k': 'create10k', '08_create1k-after1k_x2': 'append', '09_clear1k_x8': 'clear',
};

const median = (a) => {
  if (a == null) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const totalOf = (v) => (Array.isArray(v?.total) ? median(v.total) : v?.total?.median ?? NaN);

function geomean(f) {
  let s = 0;
  for (const b of CPU) s += Math.log(f[b]);
  return Math.exp(s / CPU.length);
}

/* ---- 1. 公开榜单：framework -> bench -> median ---- */
const pub = JSON.parse(readFileSync(PUB, 'utf8'));
const table = new Map();
for (const e of pub) {
  if (!CPU.includes(e.benchmark)) continue;
  if (!table.has(e.framework)) table.set(e.framework, new Map());
  table.get(e.framework).set(e.benchmark, totalOf(e.values));
}
const PUB_BASE = 'vanillajs-keyed';
const pubBase = table.get(PUB_BASE);

const pubRank = [];
for (const [fw, m] of table) {
  if (CPU.some((b) => !m.has(b) || !Number.isFinite(m.get(b)))) continue;
  const f = Object.fromEntries(CPU.map((b) => [b, m.get(b) / pubBase.get(b)]));
  pubRank.push({ fw, f, gm: geomean(f), keyed: fw.endsWith('-keyed') && !fw.includes('non-keyed') });
}
pubRank.sort((a, b) => a.gm - b.gm);

/* ---- 2. 本会话配对：@re 与 solid 的因子（除以本会话 vanilla） ---- */
const ours = { vanillajs: new Map(), re: new Map(), solid: new Map() };
for (const f of readdirSync(RAW)) {
  let key;
  if (f.startsWith('vanillajs-keyed_')) key = 'vanillajs';
  else if (f.startsWith('re-v')) key = 're';
  else if (f.startsWith('solid-')) key = 'solid';
  else continue;
  const bench = f.replace(/^(vanillajs-keyed|re-v[\d.]+-keyed|solid-v[\d.]+-keyed)_/, '').replace(/\.json$/, '');
  if (!CPU.includes(bench)) continue;
  ours[key].set(bench, totalOf(JSON.parse(readFileSync(join(RAW, f), 'utf8')).values));
}
const ourBase = ours.vanillajs;
const reFactor = Object.fromEntries(CPU.map((b) => [b, ours.re.get(b) / ourBase.get(b)]));
const solidFactor = Object.fromEntries(CPU.map((b) => [b, ours.solid.get(b) / ourBase.get(b)]));
const reGm = geomean(reFactor);
const solidGm = geomean(solidFactor);

console.log(`公开榜单 9 项数据齐全框架: ${pubRank.length}（keyed ${pubRank.filter((r) => r.keyed).length}）`);
console.log(`本会话配对: @re geomean=${reGm.toFixed(4)}  solid=${solidGm.toFixed(4)}  vanilla=1.0000\n`);

/* ---- 3. 全榜插入排位 ---- */
const all = [...pubRank, { fw: '@re ★本次实测', f: reFactor, gm: reGm, keyed: true, ours: true }, { fw: 'solid ★本次实测', f: solidFactor, gm: solidGm, keyed: true, ours: true }].sort((a, b) => a.gm - b.gm);
const idx = all.findIndex((r) => r.fw.startsWith('@re'));
console.log(`=== 全榜排位: @re 第 ${idx + 1} / ${all.length} ===`);
for (let i = Math.max(0, idx - 4); i <= Math.min(all.length - 1, idx + 2); i++) {
  const mark = all[i].ours ? '  <-- 本会话实测' : '';
  console.log(`${String(i + 1).padStart(3)}  ${all[i].gm.toFixed(4)}  ${all[i].fw}${mark}`);
}

/* ---- 4. keyed 榜单独排位 ---- */
const keyedAll = all.filter((r) => r.keyed);
const kidx = keyedAll.findIndex((r) => r.fw.startsWith('@re'));
console.log(`\n=== keyed 榜排位: @re 第 ${kidx + 1} / ${keyedAll.length} ===`);
for (let i = 0; i < Math.min(8, keyedAll.length); i++) {
  const mark = keyedAll[i].ours ? '  <-- 本会话实测' : '';
  console.log(`${String(i + 1).padStart(3)}  ${keyedAll[i].gm.toFixed(4)}  ${keyedAll[i].fw}${mark}`);
}

/* ---- 5. 逐项: @re vs 全榜最佳 / keyed 榜最佳 ---- */
console.log('\n=== @re 逐项 factor 与榜单最佳对照 ===');
console.log('bench       @re      全榜最佳  归属(截断)                        keyed最佳  归属');
for (const b of CPU) {
  const s = pubRank.map((r) => ({ fw: r.fw, v: r.f[b] })).sort((x, y) => x.v - y.v);
  const sk = s.filter((x) => x.fw.endsWith('-keyed') && !x.fw.includes('non-keyed'));
  const pos = s.findIndex((x) => x.v > reFactor[b]);
  const posK = sk.findIndex((x) => x.v > reFactor[b]);
  console.log(
    `${SHORT[b].padEnd(10)} ${reFactor[b].toFixed(3)}   ${s[0].v.toFixed(3)}    ${s[0].fw.slice(0, 30).padEnd(30)}  ${sk[0].v.toFixed(3)}(${posK < 0 ? 1 : posK + 1})  ${sk[0].fw.slice(0, 24)}  全榜名次${pos < 0 ? 1 : pos + 1}/${s.length + 1}`,
  );
}

/* ---- 6. 公开榜单上主要知名框架（给用户参照系） ---- */
console.log('\n=== 公开榜单知名框架参照（本数据集重算因子） ===');
const known = ['vanillajs-keyed', 'vanillajs-3-keyed', 'vanillajs-lite-keyed', 'solid-v1.9.3-keyed', 'svelte-v5.42.1-keyed', 'vue-vapor-v3.6.0-rc.5-keyed', 'vue-v3.5.39-keyed', 'preact-hooks-v11.0.0-keyed', 'react-hooks-v19.2.0-keyed', 'ivi-v5.1.0-keyed', 'inferno-v8.2.2-keyed', 'lit-v3.2.0-keyed', 'sauron-v0.61.4-keyed', 'blockdom-v0.9.29-keyed', 'uhtml-v5.0.3-keyed'];
const rows = known.map((fw) => {
  const r = pubRank.find((x) => x.fw === fw);
  return r ? { fw, gm: r.gm } : null;
}).filter(Boolean).sort((a, b) => a.gm - b.gm);
const kn = pubRank.filter((x) => known.includes(x.fw));
for (const fw of known) {
  const r = pubRank.find((x) => x.fw === fw);
  if (!r) continue;
  const rank = pubRank.indexOf(r) + 1;
  console.log(`${String(rank).padStart(4)}/${pubRank.length}  ${r.gm.toFixed(4)}  ${fw}`);
}
console.log(`  (@re 本会话: ${reGm.toFixed(4)};  solid 本会话: ${solidGm.toFixed(4)})`);
