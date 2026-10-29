/**
 * @zhenre/core — anchored keyed list engine (v3, lean parallel-array core)
 *
 * State is four parallel arrays aligned with DOM order:
 *   _last[i] — item i (signal mode: the same array object the signal holds)
 *   _rows[i] — row root node
 *   _keys[i] — key(_last[i]), built lazily on the first imperative op
 *   _d[i]    — row disposal entry: ReFragment | teardown bag | null
 *              (dense, exactly aligned with rows; `_nDisp` counts non-null
 *              entries so disposal passes vanish when nothing is tracked)
 *
 * The `_d` ledger replaces the previous node-keyed side tables (a WeakMap
 * for plain-row bags plus a `_$fr` expando property on each row root): row
 * disposal needs no node lookups at all — the index is always at hand where
 * disposal happens, and nothing is ever written onto the DOM node.
 *
 * Fast paths (all O(1) or batch-native):
 *   append-all   — batch row renderer (mega-template cloning) into a
 *                  detached container or a single DocumentFragment insert
 *   replace-all  — detach container / replaceChildren(anchor, frag)
 *   clear        — parent.replaceChildren(anchor)
 *   swap/remove  — index scan + splice + direct DOM moves; index-addressed
 *                  swapAt()/removeAt() skip the scan and key materialization
 *   reorder      — general order pass (moves only where actually needed)
 *
 * Row renderers from `rowRenderer()` expose `.batch()`; the engine detects
 * it and builds rows in mega-template batches (one native cloneNode per ~50
 * rows) instead of per-row clones. Batch-built rows carry no disposal entry
 * (the protocol writes text nodes directly), so the ledger pads with nulls.
 */

import type { Signal, Sub, ReOwner } from './signal.ts';
import { owner } from './signal.ts';
import { ReFragment } from './fragment.ts';
import { popScope, pushScope, runCleanups } from './lifecycle.ts';

/** Row disposal entry: a mounted template fragment, a plain teardown bag, or nothing. */
type D = ReFragment | (() => void)[] | null;

/** Build rows for items[start..start+n) into `target`; push roots into `rowsOut`. */
export interface RowBatchFn<T> {
  (
    items: readonly T[],
    start: number,
    n: number,
    target: ParentNode,
    rowsOut?: ChildNode[] | null,
  ): void;
}

/**
 * Row renderer: a plain render function, or a compiled batch renderer
 * (the output of `rowRenderer()` — its `.batch()` drives mega-template
 * cloning and the render function is never called).
 */
export type RowRender<T> = ((item: T) => Node) | { batch: RowBatchFn<T> };

export class KeyedView<T> {
  readonly anchor: Node;

  private readonly _list: Signal<readonly T[]> | readonly T[];
  private readonly _isSig: boolean;
  private readonly _key: (item: T) => unknown;
  private readonly _render: (item: T) => Node;
  private readonly _batch: RowBatchFn<T> | null;
  // NOTE: with a batch renderer `_render` is never invoked — rows come from
  // `.batch()` and carry no per-row reactive machinery.
  l: readonly T[] = []; // items, aligned with r/k
  r: ChildNode[] = []; // row roots
  k: unknown[] | null = null; // keys (lazy)
  private _d: D[] = []; // disposal ledger (dense, aligned with r)
  private _nDisp = 0; // non-null entries in _d
  private _sub: Sub | null = null;
  private _m = false;
  private readonly _ctx = {};

  constructor(
    anchor: Node,
    list: Signal<readonly T[]> | readonly T[],
    key: (item: T) => unknown,
    render: RowRender<T>,
  ) {
    this.anchor = anchor;
    this._list = list;
    this._isSig = isSig(list);
    this._key = key;
    this._render = render as (item: T) => Node;
    this._batch = (
      typeof (render as { batch?: unknown }).batch === 'function'
        ? (render as { batch: RowBatchFn<T> }).batch
        : null
    );
  }

  private get _pn(): ParentNode {
    return this.anchor.parentNode as ParentNode;
  }

  mount(): void {
    if (this._m) return;
    this._m = true;
    // whitespace-only text siblings would disable the O(1) container paths
    const parent = this.anchor.parentNode;
    if (parent !== null) {
      let c = parent.firstChild;
      while (c !== null) {
        const next = c.nextSibling;
        if (c !== this.anchor && c.nodeType === 3 && (c as Text).data.trim() === '') {
          parent.removeChild(c);
        }
        c = next;
      }
    }
    if (this._isSig) {
      const view = this;
      this._sub = {
        run(v: unknown) {
          view.sync(v as readonly T[]);
        },
      };
      (this._list as Signal<readonly T[]>).$sub(this._sub);
    }
    this.sync(
      this._isSig
        ? (this._list as Signal<readonly T[]>).peek()
        : (this._list as readonly T[]),
    );
  }

  sync(next: readonly T[]): void {
    if (!this._m) this.mount();
    const old = this.l;
    if (next === old && this._isSig) return;

    if (next.length === 0) {
      this._clear();
      this.l = next;
      return;
    }
    if (old.length === 0) {
      this._appendAll(next, 0);
      this.l = next;
      return;
    }

    const key = this._key;

    // old is a strict prefix of next -> append the tail. Identity hits
    // (in-place concat keeps the shared item objects) skip the key() call.
    if (next.length > old.length) {
      let prefix = true;
      for (let i = 0; i < old.length; i++) {
        if (old[i] !== next[i] && key(old[i]!) !== key(next[i]!)) {
          prefix = false;
          break;
        }
      }
      if (prefix) {
        this._appendAll(next, old.length);
        this.l = next;
        return;
      }
    }

    // no common keys -> single replace
    const keyFn = key;
    const oldKeys = new Set<unknown>();
    for (let i = 0; i < old.length; i++) oldKeys.add(keyFn(old[i]!));
    let common = false;
    for (let i = 0; i < next.length; i++) {
      if (oldKeys.has(keyFn(next[i]!))) {
        common = true;
        break;
      }
    }
    if (!common) {
      this._replaceAll(next);
      this.l = next;
      return;
    }
    this._diff(next);
    this.l = next;
  }

  ref(key: unknown): Node | null {
    const i = this._idx(key);
    return i >= 0 ? this.r[i]! : null;
  }

  get size(): number {
    return this.r.length;
  }

  /** Swap two rows by key in O(1). Updates the source list in place. */
  swap(ka: unknown, kb: unknown): void {
    if (ka === kb) return;
    const keys = this._keys();
    let ia = -1;
    let ib = -1;
    for (let i = 0; i < keys.length; i++) {
      const kk = keys[i];
      if (kk === ka) ia = i;
      else if (kk === kb) ib = i;
      if (ia >= 0 && ib >= 0) break;
    }
    if (ia < 0 || ib < 0) return;
    this.swapAt(ia, ib);
  }

  /** Swap two rows by INDEX in O(1) — no key materialization, no scan.
   *  Index space is current DOM/item order (they always agree). When the
   *  key cache is already built it is swapped too, so key-addressed ops
   *  stay coherent. Updates the source list in place. */
  swapAt(ia: number, ib: number): void {
    if (ia === ib || ia < 0 || ib < 0) return;
    const rows = this.r;
    if (ia >= rows.length || ib >= rows.length) return;
    const x = ia < ib ? rows[ia]! : rows[ib]!; // earlier
    const y = ia < ib ? rows[ib]! : rows[ia]!; // later
    const yNext = y.nextSibling;
    const parent = this._pn;
    parent.insertBefore(y, x);
    parent.insertBefore(x, yNext);
    rows[ia] = y;
    rows[ib] = x;
    if (this.k !== null) {
      const kk = this.k[ia]!;
      this.k[ia] = this.k[ib]!;
      this.k[ib] = kk;
    }
    const arr = this.l as T[];
    const t = arr[ia]!;
    arr[ia] = arr[ib]!;
    arr[ib] = t;
  }

  /** Remove one row by key in O(1). Updates the source list in place. */
  remove(key: unknown): void {
    const keys = this._keys();
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === key) {
        this.removeAt(i);
        return;
      }
    }
  }

  /** Remove the row at INDEX i in O(1) — no key materialization, no scan.
   *  Index space is current DOM/item order (they always agree). */
  removeAt(i: number): void {
    const rows = this.r;
    if (i < 0 || i >= rows.length) return;
    this._disposeAt(i);
    rows[i]!.remove();
    rows.splice(i, 1);
    this._d.splice(i, 1);
    if (this.k !== null) this.k.splice(i, 1);
    (this.l as T[]).splice(i, 1);
  }

  dispose(): void {
    if (this._sub !== null) {
      (this._list as Signal<readonly T[]>).$unsub(this._sub);
      this._sub = null;
    }
    this._clear();
    this._m = false;
  }

  /* ------------------------------------------------------------ */
  /* internals                                                     */
  /* ------------------------------------------------------------ */

  private _keys(): unknown[] {
    let kk = this.k;
    if (kk === null) {
      const key = this._key;
      const l = this.l;
      kk = this.k = new Array(l.length);
      for (let i = 0; i < l.length; i++) kk[i] = key(l[i]!);
    }
    return kk;
  }

  private _idx(key: unknown): number {
    const kk = this.k;
    if (kk === null) {
      const keyFn = this._key;
      const l = this.l;
      for (let i = 0; i < l.length; i++) if (keyFn(l[i]!) === key) return i;
      return -1;
    }
    for (let i = 0; i < kk.length; i++) if (kk[i] === key) return i;
    return -1;
  }

  /** Render one item; push the row root and its disposal entry into the
   *  given out arrays (the caller's ledger destination). Returns the root. */
  private _create(item: T, rowsOut: ChildNode[], dOut: D[]): ChildNode {
    const prev = owner.current;
    owner.current = this._ctx;
    const frame = pushScope();
    let r: Node;
    let bag: (() => void)[] | null = null;
    try {
      r = this._render(item);
    } finally {
      bag = popScope(frame);
      owner.current = prev;
    }
    if (r instanceof ReFragment) {
      if (bag !== null) {
        r.disposers = r.disposers === null ? bag : [...r.disposers, ...bag];
      }
      const root = (r.root ?? r) as ChildNode;
      rowsOut.push(root);
      dOut.push(r);
      return root;
    }
    rowsOut.push(r as ChildNode);
    dOut.push(bag);
    return r as ChildNode;
  }

  /** Dispose the row at index `i` (no-op when nothing is tracked). */
  private _disposeAt(i: number): void {
    const e = this._d[i] ?? null;
    if (e === null) return;
    this._d[i] = null;
    this._nDisp--;
    if (e instanceof ReFragment) e.dispose();
    else runCleanups(e);
  }

  /** Dispose every tracked row entry. When `_nDisp === 0` (rows never
   *  registered anything) this is a single integer check. The fragment
   *  fast path is inlined — a 10k-row teardown skips 10k method calls. */
  private _disposeAll(): void {
    if (this._nDisp === 0) return;
    const d = this._d;
    for (let i = 0; i < d.length; i++) {
      const e = d[i]!;
      if (e === null) continue;
      d[i] = null;
      if (e instanceof ReFragment) {
        const s = e.sub0;
        if (s !== null) {
          e.sub0 = null;
          (e.sig0 as ReOwner).$unsub(s);
        }
        const dd = e.disposers;
        if (dd !== null) {
          e.disposers = null;
          for (let j = 0; j < dd.length; j++) dd[j]!();
        }
      } else {
        runCleanups(e);
      }
    }
    this._nDisp = 0;
  }

  /** Build rows for items[start..) into `target`. */
  private _fill(target: ParentNode, items: readonly T[], start: number): void {
    const batch = this._batch;
    const rows = this.r;
    if (batch !== null) {
      batch(items, start, items.length - start, target, rows);
      const d = this._d;
      while (d.length < rows.length) d.push(null);
      return;
    }
    for (let i = start; i < items.length; i++) {
      const root = this._create(items[i]!, rows, this._d);
      target.appendChild(root);
    }
  }

  private _appendAll(items: readonly T[], start: number): void {
    const parent = this._pn;
    const n = items.length - start;
    const rows = this.r;
    const gp = parent.parentNode;
    // anchor-only container + large batch -> build inside the detached
    // container (skips per-insert layout invalidation), then reinsert once
    const detached =
      gp !== null &&
      n >= 32 &&
      (parent as Node).isConnected === true &&
      parent.firstChild === this.anchor &&
      parent.lastChild === this.anchor;
    const ref = detached ? (parent as Node).nextSibling : null;
    if (detached) gp!.removeChild(parent as Node);

    const batch = this._batch;
    if (batch !== null) {
      if (detached) {
        batch(items, start, n, parent, rows);
      } else {
        // live container with siblings: stage the whole batch in a
        // fragment and insert once (one container mutation total)
        const stage = document.createDocumentFragment();
        batch(items, start, n, stage, rows);
        parent.insertBefore(stage, null);
      }
      const d = this._d;
      while (d.length < rows.length) d.push(null);
    } else {
      const stage = detached ? null : document.createDocumentFragment();
      const target: ParentNode = detached ? parent : stage!;
      for (let i = start; i < items.length; i++) {
        const root = this._create(items[i]!, rows, this._d);
        target.appendChild(root);
      }
      if (!detached) parent.insertBefore(stage!, null);
    }
    if (detached) gp!.insertBefore(parent as Node, ref);
  }

  private _replaceAll(next: readonly T[]): void {
    const parent = this._pn;
    const rows = this.r;
    const n = rows.length;
    this._disposeAll();
    const ownedOnly =
      parent.childNodes.length === n + 1 && this.anchor.parentNode === parent;
    if (ownedOnly) {
      rows.length = 0;
      this._d.length = 0;
      this.k = null;
      const gp = parent.parentNode;
      const detached = gp !== null && next.length >= 32 && (parent as Node).isConnected === true;
      if (detached) {
        const ref = (parent as Node).nextSibling;
        gp!.removeChild(parent as Node);
        parent.replaceChildren(this.anchor);
        this._fill(parent, next, 0);
        gp!.insertBefore(parent as Node, ref);
      } else {
        const stage = document.createDocumentFragment();
        this._fill(stage, next, 0);
        parent.replaceChildren(this.anchor, stage);
      }
    } else {
      // foreign siblings present: remove rows individually, keep the rest
      for (let i = 0; i < n; i++) rows[i]!.remove();
      rows.length = 0;
      this._d.length = 0;
      this.k = null;
      this._fill(parent, next, 0);
    }
  }

  private _clear(): void {
    const parent = this._pn;
    const rows = this.r;
    this._disposeAll();
    if (parent.childNodes.length === rows.length + 1 && this.anchor.parentNode === parent) {
      parent.replaceChildren(this.anchor);
    } else {
      for (let i = 0; i < rows.length; i++) rows[i]!.remove();
    }
    this.r = [];
    this._d = [];
    this.k = null;
  }

  private _diff(next: readonly T[]): void {
    const key = this._key;
    const keys = this._keys();
    const rows = this.r;
    const parent = this._pn;

    const nextKeys = new Set<unknown>();
    for (let i = 0; i < next.length; i++) nextKeys.add(key(next[i]!));
    // kept rows are remembered by OLD index — the `_d` ledger transfers
    // without any node-keyed lookup
    const kept = new Map<unknown, number>();
    for (let i = 0; i < keys.length; i++) {
      const kk = keys[i]!;
      if (nextKeys.has(kk)) kept.set(kk, i);
      else {
        const row = rows[i]!;
        this._disposeAt(i);
        row.remove();
      }
    }

    const nKeys: unknown[] = [];
    const nRows: ChildNode[] = [];
    const nD: D[] = [];
    let ref = this.anchor as ChildNode;
    for (let i = 0; i < next.length; i++) {
      const item = next[i]!;
      const kk = key(item);
      const oi = kept.get(kk);
      let row: ChildNode;
      if (oi === undefined || rows[oi] === undefined) {
        // not kept, or a stale index (plain-array mode: the shared source
        // array was mutated in place before sync) — render fresh
        row = this._create(item, nRows, nD);
      } else {
        row = rows[oi]!;
        nRows.push(row);
        nD.push(this._d[oi] ?? null);
      }
      if (ref.nextSibling !== row) parent.insertBefore(row, ref.nextSibling);
      nKeys.push(kk);
      ref = row;
    }
    let nDisp = 0;
    for (let i = 0; i < nD.length; i++) if (nD[i] !== null) nDisp++;
    this.k = nKeys;
    this.r = nRows;
    this._d = nD;
    this._nDisp = nDisp;
  }
}

function isSig(v: unknown): v is Signal<unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Signal<unknown>).peek === 'function' &&
    typeof (v as Signal<unknown>).$sub === 'function'
  );
}

/* ------------------------------------------------------------------ */
/* mounting                                                            */
/* ------------------------------------------------------------------ */

/**
 * Mount an anchored keyed view at the end of `parent` (lean embedding —
 * no template runtime needed). Returns the live view with O(1)
 * swap()/remove()/ref() direct ops.
 */
export function mountList<T>(
  parent: ParentNode,
  list: Signal<readonly T[]> | readonly T[],
  key: (item: T) => unknown,
  render: RowRender<T>,
): KeyedView<T> {
  const a = document.createComment('re');
  parent.appendChild(a);
  const view = new KeyedView<T>(a, list, key, render);
  view.mount();
  return view;
}

/* ------------------------------------------------------------------ */
/* directive (compat — template-runtime embedding via html`${dir}`)     */
/* ------------------------------------------------------------------ */

export interface EachDirective<T> {
  readonly _$each: true;
  _view: KeyedView<T> | null;
  _mount(anchor: Node): KeyedView<T>;
  sync(next: readonly T[]): void;
  ref(key: unknown): Node | null;
  swap(ka: unknown, kb: unknown): void;
  swapAt(ia: number, ib: number): void;
  remove(key: unknown): void;
  removeAt(i: number): void;
  readonly size: number;
}

export function each<T>(
  list: Signal<readonly T[]> | readonly T[],
  key: (item: T) => unknown,
  render: RowRender<T>,
): EachDirective<T> {
  const dir: EachDirective<T> = {
    _$each: true,
    _view: null,
    _mount(anchor: Node): KeyedView<T> {
      const view = new KeyedView<T>(anchor, list, key, render);
      dir._view = view;
      return view;
    },
    sync(next: readonly T[]): void {
      dir._view?.sync(next);
    },
    ref(key: unknown): Node | null {
      return dir._view?.ref(key) ?? null;
    },
    swap(ka: unknown, kb: unknown): void {
      dir._view?.swap(ka, kb);
    },
    swapAt(ia: number, ib: number): void {
      dir._view?.swapAt(ia, ib);
    },
    remove(key: unknown): void {
      dir._view?.remove(key);
    },
    removeAt(i: number): void {
      dir._view?.removeAt(i);
    },
    get size(): number {
      return dir._view?.size ?? 0;
    },
  };
  return dir;
}

export function mountEach<T>(parent: ParentNode, dir: EachDirective<T>): KeyedView<T> {
  const a = document.createComment('re');
  parent.appendChild(a);
  const view = dir._mount(a);
  view.mount(); // the anchor is live — mount now (the template runtime
  // defers this to frag.mounts because its anchor starts detached)
  return view;
}
