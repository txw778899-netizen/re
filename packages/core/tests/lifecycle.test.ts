import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.ts';
setupDom();

const {
  onCleanup,
  runWithCleanup,
  runCleanups,
  signal,
  effect,
  html,
  mountList,
  defineElement,
} = await import('../src/index.ts');

test('lifecycle: runWithCleanup collects onCleanup in order', () => {
  const order: string[] = [];
  const { bag, result } = runWithCleanup(() => {
    onCleanup(() => order.push('a'));
    onCleanup(() => order.push('b'));
    return 42;
  });
  assert.equal(result, 42);
  assert.equal(order.length, 0);
  runCleanups(bag);
  assert.deepEqual(order, ['a', 'b']);
  // bag emptied — second run is a no-op
  runCleanups(bag);
  assert.deepEqual(order, ['a', 'b']);
});

test('lifecycle: nested contexts — inner registration goes to inner bag', () => {
  const order: string[] = [];
  const outer = runWithCleanup(() => {
    onCleanup(() => order.push('outer'));
    const inner = runWithCleanup(() => {
      onCleanup(() => order.push('inner'));
      return 'x';
    });
    runCleanups(inner.bag);
    assert.deepEqual(order, ['inner']);
    return 'done';
  });
  assert.equal(outer.result, 'done');
  runCleanups(outer.bag);
  assert.deepEqual(order, ['inner', 'outer']);
});

test('lifecycle: onCleanup outside any context is a no-op', () => {
  assert.doesNotThrow(() => onCleanup(() => {
    throw new Error('must never run');
  }));
});

test('lifecycle: effect created in a store-like context is disposed with it', () => {
  const s = signal(1);
  let runs = 0;
  const { bag } = runWithCleanup(() => {
    effect(() => {
      runs += s.value;
    });
  });
  assert.equal(runs, 1);
  s.value = 2;
  assert.equal(runs, 3);
  runCleanups(bag);
  s.value = 5;
  assert.equal(runs, 3); // disposed — no further runs
});

test('lifecycle: defineElement — onCleanup runs on disconnect', () => {
  const order: string[] = [];
  defineElement('lc-test-el', (el, root) => {
    root.append(html`<span>hi</span>`);
    onCleanup(() => order.push('ctx'));
    return () => order.push('returned');
  });
  const el = document.createElement('lc-test-el');
  document.body.append(el);
  assert.deepEqual(order, []); // setup ran, nothing torn down yet
  el.remove();
  assert.deepEqual(order, ['ctx', 'returned']);
});

test('lifecycle: each rows — onCleanup runs when a row is removed', () => {
  const dead: string[] = [];
  const list = signal([{ id: 1 }, { id: 2 }, { id: 3 }]);
  const host = document.createElement('div');
  document.body.append(host);
  const view = mountList(
    host,
    list,
    (x) => x.id,
    (x) => {
      const frag = html`<div>row ${x.id}</div>`;
      onCleanup(() => dead.push('row' + x.id));
      return frag;
    },
  );
  assert.equal(view.size, 3);
  list.value = [{ id: 1 }, { id: 3 }]; // removes row 2 via diff
  assert.deepEqual(dead, ['row2']);
  list.value = []; // clear remaining
  assert.deepEqual(dead, ['row2', 'row1', 'row3']);
  host.remove();
});

test('lifecycle: each rows — plain-node render with onCleanup also disposed', () => {
  const dead: string[] = [];
  const list = signal([{ id: 1 }, { id: 2 }]);
  const host = document.createElement('div');
  document.body.append(host);
  const view = mountList(
    host,
    list,
    (x) => x.id,
    (x) => {
      const d = document.createElement('div');
      d.textContent = 'row' + x.id;
      onCleanup(() => dead.push('plain' + x.id));
      return d; // NOT a ReFragment — bag lands in the row WeakMap
    },
  );
  assert.equal(view.size, 2);
  list.value = [{ id: 2 }];
  assert.deepEqual(dead, ['plain1']);
  host.remove();
});
