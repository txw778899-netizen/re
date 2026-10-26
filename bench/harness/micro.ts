// Phase-level micro bench: buildData vs sync vs paint for 10k rows.
import { signal, html, append, each } from '@zhenre/core';
import type { Signal } from '@zhenre/core';

function _random(max: number): number {
  return Math.round(Math.random() * 1000) % max;
}
const ADJ = ['pretty','large','big','small','tall','short','long','handsome','plain','quaint','clean','elegant','easy','angry','crazy','helpful','mushy','odd','unsightly','adorable','important','inexpensive','cheap','expensive','fancy'];
const COL = ['red','yellow','blue','green','pink','brown','purple','brown','white','black','orange'];
const NOUN = ['table','chair','house','bbq','desk','car','pony','cookie','sandwich','burger','pizza','mouse','keyboard'];
let idSeq = 1;
interface Row { id: number; label: Signal<string>; }
function buildData(count: number): Row[] {
  const data: Row[] = new Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = { id: idSeq++, label: signal(ADJ[_random(ADJ.length)] + ' ' + COL[_random(COL.length)] + ' ' + NOUN[_random(NOUN.length)]) };
  }
  return data;
}

const rows = signal<Row[]>([]);
const rowTpl = (r: Row): Node => {
  const f = html`<tr><td class="col-md-1">${r.id}</td><td class="col-md-4"><a>${r.label}</a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td></tr>`;
  (f.root as unknown as { data_id: number }).data_id = r.id;
  return f;
};
const list = each(rows, (r) => r.id, rowTpl);
const tbody = document.getElementById('tbody')!;
append(tbody, html`${list}`);

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function run(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  // warm
  rows.value = buildData(1000);
  rows.value = [];
  await raf();

  const build: number[] = [];
  const syncT: number[] = [];
  const paint: number[] = [];
  for (let i = 0; i < 8; i++) {
    rows.value = [];
    await raf();
    const t0 = performance.now();
    const data = buildData(10000);
    const t1 = performance.now();
    rows.value = data;
    const t2 = performance.now();
    await raf();
    const t3 = performance.now();
    build.push(t1 - t0);
    syncT.push(t2 - t1);
    paint.push(t3 - t2);
  }
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!;
  out.build10k_ms = med(build).toFixed(2);
  out.sync10k_ms = med(syncT).toFixed(2);
  out.paint10k_ms = med(paint).toFixed(2);

  // isolate per-row template instantiation cost (no DOM insert)
  rows.value = [];
  await raf();
  const inst: number[] = [];
  for (let i = 0; i < 5; i++) {
    const data = buildData(10000);
    const t0 = performance.now();
    const frags: Node[] = new Array(data.length);
    for (let j = 0; j < data.length; j++) frags[j] = rowTpl(data[j]!);
    const t1 = performance.now();
    inst.push(t1 - t0);
    rows.value = data;
    await raf();
    rows.value = [];
    await raf();
  }
  out.instantiate10k_ms = med(inst).toFixed(2);

  // clone-only baseline (what vanilla pays per row)
  const cloneOnly: number[] = [];
  for (let i = 0; i < 5; i++) {
    const tr = rowTpl(buildData(1)[0]!) as HTMLElement;
    const t0 = performance.now();
    const arr: Node[] = new Array(10000);
    for (let j = 0; j < 10000; j++) arr[j] = tr.cloneNode(true);
    const t1 = performance.now();
    cloneOnly.push(t1 - t0);
  }
  out.cloneOnly10k_ms = med(cloneOnly).toFixed(2);

  // buildData without signals
  const plain: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const arr: { id: number; label: string }[] = new Array(10000);
    for (let j = 0; j < 10000; j++) {
      arr[j] = { id: idSeq++, label: ADJ[_random(ADJ.length)] + ' ' + COL[_random(COL.length)] + ' ' + NOUN[_random(NOUN.length)] };
    }
    const t1 = performance.now();
    plain.push(t1 - t0);
  }
  out.buildPlain10k_ms = med(plain).toFixed(2);

  return out;
}

const btn = document.createElement('button');
btn.textContent = 'run';
btn.onclick = async () => {
  const r = await run();
  document.title = JSON.stringify(r);
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(r, null, 2);
  document.body.appendChild(pre);
};
document.body.appendChild(btn);
