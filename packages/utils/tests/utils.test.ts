import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  delay,
  debounce,
  throttle,
  dblock,
  rafThrottle,
  once,
  memoize,
  uid,
  clamp,
} = await import('../src/index.ts');

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('delay: resolves after ms', async () => {
  const t0 = Date.now();
  await delay(30);
  assert.ok(Date.now() - t0 >= 25);
});

test('delay: rejects on abort', async () => {
  const ac = new AbortController();
  const p = delay(10_000, ac.signal);
  setTimeout(() => ac.abort(), 5);
  await assert.rejects(p, () => true);
});

test('delay: immediate abort rejects synchronously', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(delay(10_000, ac.signal), () => true);
});

test('debounce: fires once after the last call', async () => {
  let n = 0;
  const d = debounce(() => n++, 30);
  d();
  d();
  d();
  assert.equal(n, 0);
  await tick(50);
  assert.equal(n, 1);
});

test('debounce: last args win, flush/cancel work', async () => {
  let got: number[] | null = null;
  const d = debounce((...a: number[]) => { got = a; }, 30);
  d(1);
  d(2);
  d.flush();
  assert.deepEqual(got, [2]);
  d(3);
  d.cancel();
  await tick(40);
  assert.deepEqual(got, [2]); // cancelled — no third run
});

test('debounce: preserves this', async () => {
  const obj = { v: 7, seen: 0 };
  obj.hit = debounce(function (this: typeof obj) { this.seen = this.v; }, 10);
  await obj.hit();
  await tick(20);
  assert.equal(obj.seen, 7);
});

test('throttle: leading immediate + trailing last', async () => {
  let n = 0;
  let last = 0;
  const t = throttle((v: number) => { n++; last = v; }, 40);
  t(1);
  t(2);
  t(3);
  assert.equal(n, 1);
  assert.equal(last, 1);
  await tick(60);
  assert.equal(n, 2);
  assert.equal(last, 3); // trailing call carried the last args
});

test('throttle: cancel drops trailing call', async () => {
  let n = 0;
  const t = throttle(() => n++, 30);
  t();
  t();
  t.cancel();
  await tick(50);
  assert.equal(n, 1);
});

test('dblock: concurrent calls coalesce onto the in-flight run', async () => {
  let runs = 0;
  const load = dblock(async (id: string) => {
    runs++;
    await tick(20);
    return `res-${id}`;
  });
  const [a, b] = await Promise.all([load('x'), load('x')]);
  assert.equal(runs, 1);
  assert.equal(a, 'res-x');
  assert.equal(b, 'res-x');
  await load('y'); // previous run finished — new run starts
  assert.equal(runs, 2);
});

test('dblock: rejection clears the lock', async () => {
  let runs = 0;
  const boom = dblock(async () => {
    runs++;
    await tick(10);
    throw new Error('nope');
  });
  await assert.rejects(boom(), /nope/);
  await assert.rejects(boom(), /nope/);
  assert.equal(runs, 2);
});

test('rafThrottle: coalesces a burst (setTimeout fallback in node)', async () => {
  let n = 0;
  let got: number | null = null;
  const r = rafThrottle((v: number) => { n++; got = v; });
  r(1);
  r(2);
  r(3);
  await tick(30);
  assert.equal(n, 1);
  assert.equal(got, 3);
});

test('once: single evaluation', () => {
  let n = 0;
  const o = once(() => ++n);
  assert.equal(o(), 1);
  assert.equal(o(), 1);
  assert.equal(n, 1);
});

test('memoize: caches by key, keyFn supported', () => {
  let n = 0;
  const f = memoize((a: string) => `${a}:${++n}`);
  assert.equal(f('a'), 'a:1');
  assert.equal(f('a'), 'a:1');
  assert.equal(f('b'), 'b:2');
  const sum = memoize((o: { x: number }) => o.x, (o) => o.x);
  assert.equal(sum({ x: 1 }), 1);
  assert.equal(sum({ x: 1 }), 1);
});

test('uid: unique across calls', () => {
  const s = new Set<string>();
  for (let i = 0; i < 1000; i++) s.add(uid());
  assert.equal(s.size, 1000);
});

test('clamp', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});
