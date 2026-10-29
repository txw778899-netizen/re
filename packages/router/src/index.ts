/**
 * @zhenre/router — minimal reactive client router
 *
 * The current location IS a signal: templates update directly, no re-render,
 * no diff. Matching is segment-based (`/user/:id`, `*` wildcard); static
 * segments outrank params, params outrank wildcard.
 *
 * Navigation pipeline (push/replace/popstate all flow through it):
 *
 *   resolve → guards (async ok; `false` cancels, string redirects, cap 10)
 *           → history write → route signal commit
 *
 * `outlet(el, render, { transition })` swaps views and pairs with
 * @zhenre/animation: it appends the new node, hands `(oldNode, newNode)` to
 * your transition (typically `animateLeave` + `animateEnter`), then removes
 * the old node when the promise settles. Stale async renders are token-guarded.
 *
 * ```ts
 * const router = createRouter({
 *   mode: 'history',
 *   routes: [{ path: '/' }, { path: '/user/:id', name: 'user' }, { path: '*', name: '404' }],
 *   guards: [(to) => to.path.startsWith('/admin') && !authed() ? '/login' : undefined],
 * });
 * router.start();
 * ```
 */

import { effect, signal } from '@zhenre/core';
import type { Signal } from '@zhenre/core';

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

export interface RouteDef {
  path: string;
  name?: string;
  meta?: Record<string, unknown>;
}

export interface RouteMatch {
  /** Matched pathname (no query/hash), always starts with `/`. */
  path: string;
  /** Full location descriptor: path + search + hash. */
  fullPath: string;
  /** Decoded path params (`:id`, plus `wildcard` for `*`). */
  params: Record<string, string>;
  query: URLSearchParams;
  hash: string;
  route: RouteDef | null;
}

/** `false` cancels; a string redirects; `undefined`/`true` continues. */
export type GuardResult = void | boolean | string | Promise<void | boolean | string>;

export type Guard = (to: RouteMatch, from: RouteMatch | null) => GuardResult;

export interface OutletOptions {
  /**
   * Both nodes are in the DOM when called; return a promise that settles
   * when the swap is done — the old node is removed afterwards.
   */
  transition?: (from: Node, to: Node) => Promise<unknown>;
}

export interface Router {
  /** Reactive current route (drives `html`` templates directly). */
  route: Signal<RouteMatch>;
  start(): void;
  stop(): void;
  resolve(path: string): RouteMatch;
  push(to: string): Promise<RouteMatch>;
  replace(to: string): Promise<RouteMatch>;
  /** Append a view-swapping outlet into `el`; returns its disposer. */
  outlet(
    el: Element,
    render: (m: RouteMatch) => Node | Promise<Node>,
    opts?: OutletOptions,
  ): () => void;
}

export interface RouterOptions {
  routes: RouteDef[];
  mode?: 'history' | 'hash';
  guards?: Guard[];
  /** History-mode base path, default `''` (same origin root). */
  base?: string;
}

/* ------------------------------------------------------------------ */
/* matching                                                            */
/* ------------------------------------------------------------------ */

interface CompiledRoute {
  def: RouteDef;
  segs: { kind: 0 | 1 | 2; name: string }[]; // 0 static, 1 param, 2 wildcard
  score: number;
}

function compile(def: RouteDef): CompiledRoute {
  const raw = def.path.split('/');
  const segs: CompiledRoute['segs'] = [];
  let score = 0;
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i]!;
    if (s === '') continue;
    if (s === '*') {
      segs.push({ kind: 2, name: 'wildcard' });
      score += 1;
    } else if (s.charCodeAt(0) === 58 /* : */) {
      segs.push({ kind: 1, name: s.slice(1) });
      score += 2;
    } else {
      segs.push({ kind: 0, name: s });
      score += 4;
    }
  }
  return { def, segs, score };
}

function matchRoute(c: CompiledRoute, segs: string[], params: Record<string, string>): boolean {
  let i = 0;
  for (; i < c.segs.length; i++) {
    const s = c.segs[i]!;
    if (s.kind === 2) {
      // wildcard needs at least one segment to absorb (`*` != `/`)
      if (segs.length <= i) return false;
      params[s.name] = segs.slice(i).map(decodeURIComponentSafe).join('/');
      return true;
    }
    if (i >= segs.length) return false;
    if (s.kind === 0) {
      if (s.name !== segs[i]) return false;
    } else {
      params[s.name] = decodeURIComponentSafe(segs[i]!);
    }
  }
  return i === segs.length;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/* ------------------------------------------------------------------ */
/* router                                                              */
/* ------------------------------------------------------------------ */

export function createRouter(opts: RouterOptions): Router {
  const mode = opts.mode ?? 'history';
  const base = opts.base ?? '';
  const guards = opts.guards ?? [];
  const compiled = opts.routes.map(compile);

  const NULL_MATCH: RouteMatch = {
    path: '/',
    fullPath: '/',
    params: {},
    query: new URLSearchParams(),
    hash: '',
    route: null,
  };

  const route = signal<RouteMatch>(NULL_MATCH);
  let lastCommitted = '';
  let started = false;

  function locationPath(): string {
    if (mode === 'hash') {
      const h = location.hash;
      return h === '' || h === '#' ? '/' : h.slice(1);
    }
    let p = location.pathname;
    if (base !== '' && p.startsWith(base)) p = p.slice(base.length) || '/';
    return p === '' ? '/' : p;
  }

  function resolve(path: string): RouteMatch {
    const q = path.indexOf('?');
    const h = path.indexOf('#');
    let pathname = q >= 0 ? path.slice(0, q) : h >= 0 ? path.slice(0, h) : path;
    let search = q >= 0 ? (h >= 0 ? path.slice(q, h) : path.slice(q)) : '';
    let hash = h >= 0 ? path.slice(h) : '';
    if (pathname === '') pathname = '/';
    const segs = pathname.split('/').filter((s) => s !== '');
    let best: CompiledRoute | null = null;
    let bestParams: Record<string, string> | null = null;
    for (let i = 0; i < compiled.length; i++) {
      const c = compiled[i]!;
      const params: Record<string, string> = {};
      if (matchRoute(c, segs, params) && (best === null || c.score > best.score)) {
        best = c;
        bestParams = params;
      }
    }
    const fullPath = pathname + search + hash;
    return {
      path: pathname,
      fullPath,
      params: bestParams ?? {},
      query: new URLSearchParams(search),
      hash,
      route: best !== null ? best.def : null,
    };
  }

  function activate(m: RouteMatch, kind: 'push' | 'replace'): void {
    const url = mode === 'hash' ? '#' + m.fullPath : base + m.fullPath;
    if (mode === 'hash') {
      if (location.hash !== url) {
        if (kind === 'push') location.hash = m.fullPath;
        else history.replaceState(null, '', url);
      }
    } else if (kind === 'push') {
      history.pushState(null, '', url === '' ? '/' : url);
    } else {
      history.replaceState(null, '', url === '' ? '/' : url);
    }
    lastCommitted = m.fullPath;
    route.value = m;
  }

  function revert(): void {
    if (lastCommitted !== '') activate(resolve(lastCommitted), 'replace');
  }

  async function go(to: string, kind: 'push' | 'replace', revertible = false): Promise<RouteMatch> {
    let current = resolve(to);
    for (let hop = 0; hop <= 10; hop++) {
      let redirect: string | null = null;
      const from = route.peek().route !== null ? route.peek() : null;
      for (let i = 0; i < guards.length; i++) {
        const r = await guards[i]!(current, from);
        if (r === false) {
          // popstate already moved history — undo; a plain push never wrote it
          if (revertible) revert();
          return route.peek();
        }
        if (typeof r === 'string') {
          redirect = r;
          break;
        }
      }
      if (redirect === null) {
        activate(current, kind);
        return current;
      }
      current = resolve(redirect);
    }
    throw new Error('[re-router] redirect loop (>10 hops) from ' + to);
  }

  function onPop(): void {
    const m = resolve(locationPath());
    if (m.fullPath === lastCommitted) return;
    go(m.fullPath, 'replace', true).catch(() => {
      // guard errors / redirect loops on back-navigation: undo the URL change
      revert();
    });
  }

  const router: Router = {
    route,
    start() {
      if (started) return;
      started = true;
      window.addEventListener(mode === 'hash' ? 'hashchange' : 'popstate', onPop);
      const m = resolve(locationPath());
      lastCommitted = m.fullPath;
      route.value = m;
    },
    stop() {
      if (!started) return;
      started = false;
      window.removeEventListener(mode === 'hash' ? 'hashchange' : 'popstate', onPop);
    },
    resolve,
    push(to: string) {
      return go(to, 'push');
    },
    replace(to: string) {
      return go(to, 'replace');
    },
    outlet(el, render, outletOpts) {
      let current: Node | null = null;
      let token = 0;
      const dispose = effect(() => {
        const m = router.route.value;
        const t = ++token;
        Promise.resolve()
          .then((): Node | Promise<Node> => render(m))
          .then(async (node) => {
            if (t !== token || node === null) return;
            const old = current;
            if (old !== null && old !== node && outletOpts?.transition !== undefined) {
              if (old.parentNode === el) el.insertBefore(node, old.nextSibling);
              else el.appendChild(node);
              current = node;
              await outletOpts.transition(old, node);
              if (t !== token) return;
              old.parentNode?.removeChild(old);
            } else if (old !== null && old !== node) {
              old.parentNode?.removeChild(old);
              el.appendChild(node);
              current = node;
            } else {
              el.appendChild(node);
              current = node;
            }
          });
      });
      return () => {
        token++;
        dispose();
      };
    },
  };

  return router;
}
