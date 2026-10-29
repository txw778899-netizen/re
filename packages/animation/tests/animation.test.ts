import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost/' });
const g = globalThis as unknown as Record<string, unknown>;
g.window = win;
g.document = win.document;
g.Element = win.Element;
g.HTMLElement = win.HTMLElement;
g.Event = win.Event;
g.getComputedStyle = win.getComputedStyle.bind(win);
g.requestAnimationFrame = win.requestAnimationFrame?.bind(win);
g.cancelAnimationFrame = win.cancelAnimationFrame?.bind(win);

const { animateEnter, animateLeave, animateSwap, stagger, flip } = await import('../src/index.ts');

const fire = (el: Element, type: string): void => {
  el.dispatchEvent(new win.Event(type, { bubbles: true }));
};

test('enter: applies from→active→to protocol and cleans up', async () => {
  const el = document.createElement('div');
  const p = animateEnter(el, 'fade');
  assert.deepEqual(
    [...el.classList].sort(),
    ['fade-enter-active', 'fade-enter-from'],
  );
  await p;
  assert.equal(el.className, '');
});

test('enter: resolves on transitionend, removes active/to classes', async () => {
  const el = document.createElement('div');
  const p = animateEnter(el, 'slide');
  await new Promise((r) => setTimeout(r, 40)); // past the double-rAF frame
  assert.ok(el.classList.contains('slide-enter-active'));
  assert.ok(el.classList.contains('slide-enter-to'));
  assert.ok(!el.classList.contains('slide-enter-from'));
  fire(el, 'transitionend');
  await p;
  assert.equal(el.className, '');
});

test('leave: applies protocol and cleans up; caller removes the node', async () => {
  const el = document.createElement('div');
  const p = animateLeave(el, 'fade');
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(el.classList.contains('fade-leave-active'));
  fire(el, 'transitionend');
  await p;
  assert.equal(el.className, '');
  el.remove();
});

test('enter: timeout fallback fires without any end event (no hang)', async () => {
  const el = document.createElement('div');
  const t0 = Date.now();
  await animateEnter(el, 'x');
  assert.ok(Date.now() - t0 < 400, 'fallback should be fast when no CSS durations');
  assert.equal(el.className, '');
});

test('enter: animationend also resolves (keyframe animations)', async () => {
  const el = document.createElement('div');
  const p = animateEnter(el, 'pop');
  await new Promise((r) => setTimeout(r, 40));
  fire(el, 'animationend');
  await p;
  assert.equal(el.className, '');
});

test('stagger: sets incremental inline delays, restores afterwards', async () => {
  const a = document.createElement('div');
  const b = document.createElement('div');
  const c = document.createElement('div');
  const p = stagger([a, b, c], 'fade', 20);
  assert.equal((a as HTMLElement).style.transitionDelay, '0ms');
  assert.equal((b as HTMLElement).style.transitionDelay, '20ms');
  assert.equal((c as HTMLElement).style.transitionDelay, '40ms');
  fire(a, 'transitionend');
  fire(b, 'transitionend');
  fire(c, 'transitionend');
  await p;
  assert.equal((a as HTMLElement).style.transitionDelay, '');
  assert.equal((c as HTMLElement).style.animationDelay, '');
});

test('flip: captures first positions, runs mutate, no-op for unmoved elements', async () => {
  const a = document.createElement('div');
  let moved = false;
  (a as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({ left: moved ? 100 : 0, top: 0, width: 10, height: 10, x: 0, y: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect;
  (a as unknown as { animate: () => { finished: Promise<void> } }).animate = () => ({
    finished: Promise.resolve(),
  });
  const p = flip([a], () => { moved = true; }, { duration: 10 });
  await p;
  assert.ok(moved);
});

test('flip: supports async mutate', async () => {
  const a = document.createElement('div');
  let done = false;
  await flip([a], async () => {
    await new Promise((r) => setTimeout(r, 10));
    done = true;
  });
  assert.ok(done);
});

test('swap: together runs leave and enter in parallel', async () => {
  const from = document.createElement('div');
  const to = document.createElement('div');
  const p = animateSwap(from, to, 'fade');
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(from.classList.contains('fade-leave-active'));
  assert.ok(to.classList.contains('fade-enter-active'));
  fire(from, 'transitionend');
  assert.ok(
    to.classList.contains('fade-enter-active'),
    'enter still running after leave settles (parallel)',
  );
  fire(to, 'transitionend');
  await p;
  assert.equal(from.className, '');
  assert.equal(to.className, '');
});

test('swap: out-in waits for leave before enter starts', async () => {
  const from = document.createElement('div');
  const to = document.createElement('div');
  const p = animateSwap(from, to, 'fade', 'out-in');
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(from.classList.contains('fade-leave-active'));
  assert.ok(!to.classList.contains('fade-enter-active'), 'enter must not start while leave runs');
  fire(from, 'transitionend');
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(to.classList.contains('fade-enter-active'));
  fire(to, 'transitionend');
  await p;
  assert.equal(from.className, '');
  assert.equal(to.className, '');
});
