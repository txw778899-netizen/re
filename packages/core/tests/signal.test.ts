import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.ts';
setupDom();

const { signal, computed, effect, batch, untrack, isSignal } = await import(
  '../src/signal.ts'
);

test('signal: basic get/set + notification', () => {
  const s = signal(1);
  assert.equal(s.value, 1);
  let seen = 0;
  s.$sub({ run(v) { seen = v as number; } });
  s.value = 42;
  assert.equal(seen, 42);
  assert.equal(s.value, 42);
});

test('signal: skip-equal (Object.is)', () => {
  const s = signal(0);
  let n = 0;
  s.$sub({ run() { n++; } });
  s.value = 0;
  s.value = NaN;
  s.value = NaN;
  assert.equal(n, 1);
});

test('signal: peek and setQuiet', () => {
  const s = signal('a');
  let n = 0;
  s.$sub({ run() { n++; } });
  s.setQuiet('b');
  assert.equal(s.peek(), 'b');
  assert.equal(n, 0);
});

test('signal: isSignal brand', () => {
  assert.ok(isSignal(signal(0)));
  assert.ok(!isSignal({}));
  assert.ok(!isSignal(() => {}));
  assert.ok(!isSignal(null));
});

test('effect: tracks dependencies and re-runs', () => {
  const a = signal(1);
  const b = signal(2);
  let runs = 0;
  let last = 0;
  const stop = effect(() => {
    runs++;
    last = a.value + b.value;
  });
  assert.equal(last, 3);
  a.value = 10;
  assert.equal(last, 12);
  assert.equal(runs, 2);
  b.value = 20;
  assert.equal(last, 30);
  assert.equal(runs, 3);
  stop();
  a.value = 100;
  assert.equal(runs, 3); // disposed — no more runs
});

test('effect: dynamic dependency set (re-track each run)', () => {
  const flag = signal(true);
  const x = signal('x');
  const y = signal('y');
  let out = '';
  effect(() => {
    out = flag.value ? x.value : y.value;
  });
  assert.equal(out, 'x');
  y.value = 'y2'; // not a dep right now — must not throw or rerun
  assert.equal(out, 'x');
  flag.value = false;
  assert.equal(out, 'y2');
});

test('computed: lazy + cached + push-through', () => {
  const a = signal(2);
  let evals = 0;
  const c = computed(() => {
    evals++;
    return a.value * 10;
  });
  assert.equal(evals, 0); // lazy
  assert.equal(c.value, 20);
  assert.equal(evals, 1);
  assert.equal(c.value, 20);
  assert.equal(evals, 1); // cached
  let seen = 0;
  c.$sub({ run(v) { seen = v as number; } });
  assert.equal(seen, 0);
  a.value = 3; // push-through on subscribed computed
  assert.equal(seen, 30);
  assert.equal(c.value, 30);
});

test('computed: chain (a -> b -> c)', () => {
  const a = signal(1);
  const b = computed(() => a.value + 1);
  const c = computed(() => b.value * 2);
  assert.equal(c.value, 4);
  let seen = 0;
  c.$sub({ run(v) { seen = v as number; } });
  a.value = 5;
  assert.equal(seen, 12);
});

test('batch: defers notifications, dedupes subs', () => {
  const a = signal(0);
  const b = signal(0);
  let runs = 0;
  let lastA = 0;
  let lastB = 0;
  effect(() => {
    runs++;
    lastA = a.value;
    lastB = b.value;
  });
  assert.equal(runs, 1);
  batch(() => {
    a.value = 1;
    b.value = 2;
    a.value = 10;
  });
  assert.equal(runs, 2); // one extra run
  assert.equal(lastA, 10);
  assert.equal(lastB, 2);
});

test('batch: nested batch is a no-op wrapper', () => {
  const a = signal(0);
  let runs = 0;
  effect(() => {
    runs++;
    a.value;
  });
  batch(() => {
    batch(() => {
      a.value = 1;
    });
    assert.equal(runs, 1); // still deferred by outer batch
  });
  assert.equal(runs, 2);
});

test('untrack: reads without subscribing', () => {
  const a = signal(1);
  let runs = 0;
  effect(() => {
    runs++;
    untrack(() => a.value);
  });
  a.value = 2;
  assert.equal(runs, 1);
});

test('signal: circular update guard throws', () => {
  const a = signal(0);
  assert.throws(
    () => {
      effect(() => {
        a.value = a.value + 1;
      });
    },
    /circular/,
  );
});

test('$sub/$unsub: exact listener removal', () => {
  const s = signal(0);
  const sub1 = { run() {} };
  const sub2 = { run() {} };
  s.$sub(sub1);
  s.$sub(sub2);
  s.$unsub(sub1);
  let hits = 0;
  sub2.run = () => hits++;
  s.value = 1;
  assert.equal(hits, 1);
});
