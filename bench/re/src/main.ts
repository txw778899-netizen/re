/**
 * @zhenre — official js-framework-benchmark implementation (keyed)
 *
 * Compiled row protocol — the shape @zhenre/compiler emits for keyed lists:
 *   - the row template is compiled ONCE by rowRenderer() into a batch
 *     renderer; rows are staged 64 at a time and mounted with ONE
 *     cloneNode(true) per batch (mega-template cloning, silicium-class
 *     native call amortization while staying a framework protocol)
 *   - slot values are written straight into the staging rows' hot text
 *     nodes — no per-row signals, fragments or subscriptions; the view's
 *     disposal ledger stays empty and disposal passes vanish
 *   - partial update writes label text through the row's live position
 *     (compile-time-proven fine-grained path; row data is plain strings)
 *   - O(1) index-addressed direct ops: swapAt()/removeAt() — no key scans,
 *     no key array materialization
 *   - event delegation on tbody (1 listener; sectionRowIndex addresses rows)
 */
import { signal, each, mountEach, rowRenderer } from '@zhenre/core';

interface Row {
  id: number;
  label: string;
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
      label:
        ADJECTIVES[_random(ADJECTIVES.length)] +
        ' ' +
        COLOURS[_random(COLOURS.length)] +
        ' ' +
        NOUNS[_random(NOUNS.length)],
    };
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* compiled row renderer (mega-template batching, 64 rows per clone)    */
/* ------------------------------------------------------------------ */

const ROW_HTML =
  '<tr><td class="col-md-1"></td><td class="col-md-4"><a></a></td>' +
  '<td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>' +
  '<td class="col-md-6"></td></tr>';

// slot paths: id text = [0,0]; label text = [1,0,0]
// batch size is URL-tunable (?batch=N) for single-variable A/B experiments
// (R7: 64 vs 128); default 64 = the R6-measured configuration.
const BATCH = Number(new URLSearchParams(location.search).get('batch')) || 64;
const rowBatch = rowRenderer<Row>(ROW_HTML, [[0, 0], [1, 0, 0]], {
  batch: BATCH,
  values(r, t) {
    t[0]!.data = '' + r.id;
    t[1]!.data = r.label;
  },
});

/* ------------------------------------------------------------------ */
/* view                                                                 */
/* ------------------------------------------------------------------ */

const rows = signal<Row[]>([]);
const list = each(rows, (r) => r.id, rowBatch);

const tbody = document.getElementById('tbody')!;
mountEach(tbody, list);

let selectedRow: HTMLElement | null = null;

/* ------------------------------------------------------------------ */
/* actions                                                              */
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
  const kids = tbody.children; // live <tr> collection (anchor is a comment)
  for (let i = 0; i < arr.length; i += 10) {
    const r = arr[i]!;
    const s = r.label + ' !!!';
    r.label = s;
    const a = (kids[i] as HTMLElement).childNodes[1]!.firstChild!;
    (a.firstChild as Text).data = s;
  }
}

function clearAll(): void {
  selectedRow = null;
  rows.value = [];
}

function swapRows(): void {
  if (rows.peek().length > 10) list.swapAt(1, 998);
}

/* ------------------------------------------------------------------ */
/* events (delegation — 1 listener on tbody)                            */
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
    // remove column -> delete row (O(1), index-addressed)
    if (tr === selectedRow) selectedRow = null;
    list.removeAt((tr as unknown as { sectionRowIndex: number }).sectionRowIndex);
  }
});
