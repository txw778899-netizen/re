import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.ts';
setupDom();

const { signal, effect, defineElement, html, mountList } = await import('@zhenre/core');
const { defineStore, useStore, destroyStore, onDestroy } = await import('../src/index.ts');

test('defineStore: singleton per id', () => {
  const useA = defineStore('t-singleton', () => ({ n: signal(1) }));
  assert.equal(useA(), useA());
  const useB = defineStore('t-other', () => ({ n: signal(1) }));
  assert.notEqual(useA(), useB());
});

test('destroyStore: teardown runs, next access re-creates', () => {
  const dead: string[] = [];
  const useS = defineStore('t-destroy', () => {
    onDestroy(() => dead.push('bye'));
    return { n: signal(0) };
  });
  const first = useS();
  assert.equal(destroyStore('t-destroy'), true);
  assert.deepEqual(dead, ['bye']);
  const second = useS();
  assert.notEqual(first, second);
  assert.equal(destroyStore('t-nope'), false);
});

test('store: effects die with the store (auto-registration)', async () => {
  const log: string[] = [];
  const ext = signal(0); // external signal, outlives the store
  const useS = defineStore('t-effect', () => {
    effect(() => {
      log.push('run' + ext.value);
    });
    return {};
  });
  useS();
  assert.deepEqual(log, ['run0']);
  ext.value = 1;
  assert.deepEqual(log, ['run0', 'run1']);
  destroyStore('t-effect');
  ext.value = 2;
  assert.deepEqual(log, ['run0', 'run1']); // disposed — no re-run
});

test('store: useStore inside a component is destroyed on disconnect', () => {
  const log: string[] = [];
  const ext = signal(0);
  defineElement('store-test-el', () => {
    const st = useStore(() => {
      onDestroy(() => log.push('destroyed'));
      effect(() => {
        log.push('run' + ext.value);
      });
      return { n: signal(0) };
    });
    st.n.value = 5;
    return () => html`<p>${st.n}</p>`;
  });

  const el = document.createElement('store-test-el') as HTMLElement;
  document.body.append(el);
  assert.ok(log.includes('run0')); // effect ran on setup
  el.remove();
  assert.ok(log.includes('destroyed'));
  const before = log.length;
  ext.value = 77;
  assert.equal(log.length, before); // effect disposed with the component
});

test('store: useStore inside a keyed row is destroyed on row removal', () => {
  const log: string[] = [];
  const list = signal([{ id: 1 }, { id: 2 }]);
  const host = document.createElement('div');
  document.body.append(host);
  const view = mountList(
    host,
    list,
    (x) => x.id,
    (x) => {
      const st = useStore(() => {
        onDestroy(() => log.push('row' + x.id));
        return { id: x.id };
      });
      return html`<div>${st.id}</div>`;
    },
  );
  assert.equal(view.size, 2);
  list.value = [{ id: 2 }];
  assert.deepEqual(log, ['row1']);
  list.value = [];
  assert.deepEqual(log, ['row1', 'row2']);
  host.remove();
});
