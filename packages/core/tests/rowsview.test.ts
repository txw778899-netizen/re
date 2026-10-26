/**
 * DOM-anchored rows view (mountRows) — behavior contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.ts';
setupDom();

const { mountRows, rowRenderer } = await import('../src/index.ts');

const SRC =
  '<tr><td class="col-md-1"></td><td class="col-md-4"><a></a></td><td class="col-md-1"><a><span></span></a></td><td class="col-md-6"></td></tr>';
const PATHS = [[0, 0], [1, 0, 0]];

function makeFill(state: { id: number }) {
  const render = rowRenderer<unknown>(SRC, PATHS, {
    values(_: unknown, texts: Text[]) {
      texts[0]!.data = state.id++;
      texts[1]!.data = 'label ' + state.id;
    },
  });
  const NO: readonly unknown[] = [];
  return (n: number, target: ParentNode) => render.batch(NO, 0, n, target, null);
}

test('build creates rows with generated ids and labels', () => {
  setupDom();
  const state = { id: 1 };
  const tbody = document.createElement('tbody');
  const view = mountRows(tbody, makeFill(state));
  view.build(3);
  assert.equal(view.size, 3);
  assert.equal(tbody.children.length, 3);
  const ids = [...tbody.children].map(
    (tr) => (tr.childNodes[0]!.childNodes[0] as Text).data
  );
  assert.deepEqual(ids, ['1', '2', '3']);
  const labels = [...tbody.children].map(
    (tr) => (tr.childNodes[1]!.childNodes[0]!.childNodes[0] as Text).data
  );
  assert.deepEqual(labels, ['label 2', 'label 3', 'label 4']);
});

test('append continues the sequence after a build', () => {
  setupDom();
  const state = { id: 1 };
  const tbody = document.createElement('tbody');
  const view = mountRows(tbody, makeFill(state));
  view.build(2);
  view.append(2);
  assert.equal(view.size, 4);
  assert.equal(
    (tbody.children[3]!.childNodes[0]!.childNodes[0] as Text).data,
    '4'
  );
});

test('clear empties the parent and build reinitializes', () => {
  setupDom();
  const state = { id: 1 };
  const tbody = document.createElement('tbody');
  const view = mountRows(tbody, makeFill(state));
  view.build(2);
  view.clear();
  assert.equal(view.size, 0);
  assert.equal(tbody.children.length, 0);
  view.build(2);
  assert.equal(view.size, 2);
  assert.equal(
    (tbody.children[0]!.childNodes[0]!.childNodes[0] as Text).data,
    '3'
  );
});

test('swapAt moves the DOM nodes (identity preserved)', () => {
  setupDom();
  const state = { id: 1 };
  const tbody = document.createElement('tbody');
  const view = mountRows(tbody, makeFill(state));
  view.build(4);
  const row1 = tbody.children[1]!;
  const row3 = tbody.children[3]!;
  view.swapAt(1, 3);
  assert.equal(tbody.children[1], row3);
  assert.equal(tbody.children[3], row1);
  assert.equal(
    (tbody.children[1]!.childNodes[0]!.childNodes[0] as Text).data,
    '4'
  );
});

test('removeAt removes exactly the target row', () => {
  setupDom();
  const state = { id: 1 };
  const tbody = document.createElement('tbody');
  const view = mountRows(tbody, makeFill(state));
  view.build(4);
  const survivor = tbody.children[2]!;
  view.removeAt(1);
  assert.equal(view.size, 3);
  assert.equal(tbody.children[1], survivor);
  assert.equal(
    (tbody.children[1]!.childNodes[0]!.childNodes[0] as Text).data,
    '3'
  );
});

test('whitespace-only text siblings are cleaned at mount', () => {
  setupDom();
  const state = { id: 1 };
  const tbody = document.createElement('tbody');
  tbody.appendChild(document.createTextNode('\n  '));
  const view = mountRows(tbody, makeFill(state));
  view.build(2);
  assert.equal(view.size, 2);
  assert.equal(tbody.firstChild!.nodeType, 1); // first row — whitespace removed
});

test('view keeps zero per-row JS state (rows live in the parent)', () => {
  setupDom();
  const state = { id: 1 };
  const tbody = document.createElement('tbody');
  const view = mountRows(tbody, makeFill(state));
  view.build(5);
  // own properties of the view object must not grow with row count
  const keys = Object.keys(view).length;
  view.build(50);
  assert.equal(Object.keys(view).length, keys);
  assert.equal(view.size, 50);
});