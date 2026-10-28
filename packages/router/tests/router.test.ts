/**
 * Router tests run against a minimal fake browser: a mutable path, a
 * pushState/replaceState history, and a manual popstate dispatcher —
 * deterministic, no happy-dom timing involved.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

type Listener = (ev?: unknown) => void;

function fakeBrowser() {
  let path = '/';
  const listeners = new Map<string, Listener[]>();
  const target = {
    addEventListener(type: string, fn: Listener): void {
      const l = listeners.get(type) ?? [];
      l.push(fn);
      listeners.set(type, l);
    },
    removeEventListener(type: string, fn: Listener): void {
      const l = listeners.get(type) ?? [];
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
  };
  const history = {
    pushState(_s: unknown, _t: string, url: string): void {
      path = url;
    },
    replaceState(_s: unknown, _t: string, url: string): void {
      path = url;
    },
  };
  const location = {
    get pathname(): string {
      return path;
    },
    get hash(): string {
      return '';
    },
  };
  const pop = (): void => {
    for (const fn of listeners.get('popstate') ?? []) fn({});
  };
  return {
    location,
    history,
    target,
    pop,
    set: (p: string): void => {
      path = p;
      pop();
    },
    reset: (): void => {
      path = '/';
    },
    get path(): string {
      return path;
    },
  };
}

const g = globalThis as unknown as Record<string, unknown>;
const browser = fakeBrowser();
g.window = browser.target;
g.location = browser.location;
g.history = browser.history;
g.URLSearchParams = URLSearchParams;

// happy-dom realm for outlet DOM tests — must precede core import
// (fragment.ts extends DocumentFragment at module-eval time)
import { Window } from 'happy-dom';
const win = new Window({ url: 'http://localhost/' });
g.document = win.document;
g.HTMLElement = win.HTMLElement;
g.Element = win.Element;
g.Node = win.Node;
g.DocumentFragment = win.DocumentFragment;
g.Document = win.Document;
g.Text = win.Text;
g.Comment = win.Comment;
g.Event = win.Event;
g.NodeFilter = win.NodeFilter;

const { createRouter } = await import('../src/index.ts');

const routes = [
  { path: '/', name: 'home' },
  { path: '/user/:id', name: 'user' },
  { path: '/files/*', name: 'files' },
  { path: '/about', name: 'about' },
  { path: '*', name: '404' },
];

test('resolve: static, param, wildcard, 404, query, hash', () => {
  const r = createRouter({ routes, mode: 'history' });
  assert.equal(r.resolve('/').route?.name, 'home');
  const u = r.resolve('/user/42');
  assert.equal(u.route?.name, 'user');
  assert.equal(u.params.id, '42');
  const f = r.resolve('/files/a/b/c.txt');
  assert.equal(f.route?.name, 'files');
  assert.equal(f.params.wildcard, 'a/b/c.txt');
  assert.equal(r.resolve('/nope').route?.name, '404');
  const q = r.resolve('/user/7?tab=info#top');
  assert.equal(q.params.id, '7');
  assert.equal(q.query.get('tab'), 'info');
  assert.equal(q.hash, '#top');
  assert.equal(q.fullPath, '/user/7?tab=info#top');
});

test('resolve: static outranks param, param outranks wildcard', () => {
  const r = createRouter({
    routes: [
      { path: '/a/:x' },
      { path: '/a/static' },
      { path: '*' },
    ],
  });
  assert.equal(r.resolve('/a/static').path, '/a/static');
  assert.notEqual(r.resolve('/a/static').route?.path, '/a/:x');
  assert.equal(r.resolve('/a/other').params.x, 'other');
});

test('start + push: history writes and route signal commits', async () => {
  const r = createRouter({ routes, mode: 'history' });
  r.start();
  assert.equal(r.route.value.path, '/');
  await r.push('/user/9');
  assert.equal(r.route.value.params.id, '9');
  assert.equal(browser.path, '/user/9');
  await r.replace('/about');
  assert.equal(r.route.value.route?.name, 'about');
  assert.equal(browser.path, '/about');
  r.stop();
});

test('guards: false cancels (no history write), string redirects', async () => {
  browser.reset();
  const calls: string[] = [];
  const r = createRouter({
    routes,
    guards: [
      (to) => {
        calls.push(to.path);
        if (to.path === '/about') return false;
        if (to.path === '/user/1') return '/user/2';
        return undefined;
      },
    ],
  });
  r.start();
  await r.push('/about');
  assert.equal(r.route.value.path, '/'); // stayed
  assert.equal(browser.path, '/'); // no history entry
  await r.push('/user/1');
  assert.equal(r.route.value.path, '/user/2');
  assert.equal(r.route.value.params.id, '2');
  assert.ok(calls.includes('/about'));
  r.stop();
});

test('guards: async guards and redirect loop detection', async () => {
  browser.reset();
  let redirected = false;
  const r = createRouter({
    routes: [{ path: '/a' }, { path: '/b' }],
    guards: [
      async (to) => {
        if (to.path === '/a' && !redirected) {
          redirected = true;
          return '/b'; // async redirect, exactly once
        }
        return undefined;
      },
    ],
  });
  r.start();
  await r.push('/a');
  assert.equal(r.route.value.path, '/b');
  r.stop();

  const loop = createRouter({ routes: [{ path: '*' }], guards: [() => '/x'] });
  loop.start();
  await assert.rejects(loop.push('/any'), /redirect loop/);
  loop.stop();
});

test('popstate: back navigation flows through guards and commits', async () => {
  browser.reset();
  const r = createRouter({ routes, mode: 'history' });
  r.start();
  await r.push('/user/5');
  browser.set('/about'); // browser back changed the URL
  browser.pop();
  await new Promise((res) => setTimeout(res, 0)); // guards are async
  assert.equal(r.route.value.route?.name, 'about');
  r.stop();
});

test('popstate: guard cancel reverts the URL', async () => {
  browser.reset();
  const r = createRouter({
    routes,
    guards: [(to) => (to.path === '/about' ? false : undefined)],
  });
  r.start();
  await r.push('/user/5');
  browser.set('/about');
  browser.pop();
  await new Promise((res) => setTimeout(res, 0));
  assert.equal(r.route.value.path, '/user/5'); // route unchanged
  assert.equal(browser.path, '/user/5'); // URL reverted
  r.stop();
});

test('outlet: swaps views on route change, disposes cleanly', async () => {
  browser.reset();
  const r = createRouter({ routes, mode: 'history' });
  r.start();
  const el = document.createElement('div');
  g.document = win.document;
  const seen: string[] = [];
  const stop = r.outlet(el, (m) => {
    const d = document.createElement('div');
    d.textContent = m.route?.name ?? 'none';
    seen.push(m.route?.name ?? 'none');
    return d;
  });
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(seen, ['home']);
  assert.equal(el.childElementCount, 1);
  await r.push('/about');
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(seen, ['home', 'about']);
  assert.equal(el.childElementCount, 1);
  assert.equal(el.firstElementChild?.textContent, 'about');
  stop();
  await r.push('/');
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(seen, ['home', 'about']); // disposed — no more renders
});

test('outlet: transition gets both nodes, old node removed after', async () => {
  browser.reset();
  const r = createRouter({ routes, mode: 'history' });
  r.start();
  const el = document.createElement('div');
  const transitions: [string, string][] = [];
  let release: (() => void) | null = null;
  const gate = new Promise<void>((res) => {
    release = res;
  });
  const stop = r.outlet(
    el,
    (m) => {
      const d = document.createElement('div');
      d.textContent = m.route?.name ?? 'none';
      return d;
    },
    {
      transition: async (from, to) => {
        transitions.push([from.textContent ?? '', to.textContent ?? '']);
        await gate;
      },
    },
  );
  await new Promise((res) => setTimeout(res, 0));
  await r.push('/about');
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(transitions, [['home', 'about']]);
  // both present while transition pending
  assert.equal(el.childElementCount, 2);
  release!();
  await new Promise((res) => setTimeout(res, 0));
  assert.equal(el.childElementCount, 1);
  assert.equal(el.firstElementChild?.textContent, 'about');
  stop();
});
