/**
 * @zhenre — official js-framework-benchmark implementation (keyed)
 *
 * Uses only public @zhenre/core API:
 *   - one signal per row label (fine-grained: partial update touches 100 text nodes)
 *   - one anchored keyed view for the tbody (fast paths: append / clear / replace)
 *   - O(1) direct ops for selection highlight, swap and removal
 *   - event delegation on tbody (2 listeners total, same as the reference)
 */
import { signal, html, append, each } from '@zhenre/core';
import type { Signal } from '@zhenre/core';

interface Row {
  id: number;
  label: Signal<string>;
}

function _random(max: number): number {
  return Math.round(Math.random() * 1000) % max;
}

const ADJECTIVES = [
  'pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome',
  'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful',
  'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive',
  'cheap', 'expensive', 'fancy',
];
const COLOURS = [
  'red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown',
  'white', 'black', 'orange',
];
const NOUNS = [
  'table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie',
  'sandwich', 'burger', 'pizza', 'mouse', 'keyboard',
];

let idSeq = 1;

function buildData(count: number): Row[] {
  const data: Row[] = new Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = {
      id: idSeq++,
      label: signal(
        ADJECTIVES[_random(ADJECTIVES.length)] +
          ' ' +
          COLOURS[_random(COLOURS.length)] +
          ' ' +
          NOUNS[_random(NOUNS.length)],
      ),
    };
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* view                                                                */
/* ------------------------------------------------------------------ */

const rows = signal<Row[]>([]);

function rowTpl(r: Row): Node {
  const f = html`<tr><td class="col-md-1">${r.id}</td><td class="col-md-4"><a>${r.label}</a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td></tr>`;
  (f.root as unknown as { data_id: number }).data_id = r.id;
  return f;
}

const list = each(rows, (r) => r.id, rowTpl);

// Compile the row template at startup (the framework equivalent of the
// reference implementation building its rowTemplate at script eval time).
rowTpl({ id: 0, label: signal('') });

const tbody = document.getElementById('tbody')!;
append(tbody, html`${list}`);

let selectedRow: HTMLElement | null = null;

/* ------------------------------------------------------------------ */
/* actions                                                             */
/* ------------------------------------------------------------------ */

function run(): void {
  selectedRow = null;
  rows.value = buildData(1000);
}

function runLots(): void {
  selectedRow = null;
  rows.value = buildData(10000);
}

function add(): void {
  rows.value = rows.peek().concat(buildData(1000));
}

function update(): void {
  const arr = rows.peek();
  for (let i = 0; i < arr.length; i += 10) {
    const r = arr[i]!;
    r.label.value = r.label.peek() + ' !!!';
  }
}

function clearAll(): void {
  selectedRow = null;
  rows.value = [];
}

function swapRows(): void {
  const arr = rows.peek();
  if (arr.length > 10) {
    list.swap(arr[1]!.id, arr[998]!.id);
  }
}

/* ------------------------------------------------------------------ */
/* events (delegation — same shape as the vanilla reference)           */
/* ------------------------------------------------------------------ */

for (const [id, fn] of [
  ['run', run],
  ['runlots', runLots],
  ['add', add],
  ['update', update],
  ['clear', clearAll],
  ['swaprows', swapRows],
] as const) {
  document.getElementById(id)!.addEventListener('click', fn);
}

tbody.addEventListener('click', (e) => {
  let p = e.target as HTMLElement | null;
  while (p && p.tagName !== 'TD') p = p.parentElement;
  if (p === null) return;
  const tr = p.parentElement as HTMLElement;
  const cols = (tr as unknown as { childNodes: Node[] }).childNodes;
  if (cols[1] === p) {
    // label column -> select (O(1))
    if (selectedRow !== null) selectedRow.className = '';
    tr.className = 'danger';
    selectedRow = tr;
  } else if (cols[2] === p) {
    // remove column -> delete row (O(1))
    const id = (tr as unknown as { data_id: number }).data_id;
    if (tr === selectedRow) selectedRow = null;
    list.remove(id);
  }
});
