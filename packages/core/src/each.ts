/**
 * @zhenre/core — anchored keyed list engine (v2, lean parallel-array core)
 *
 * State is three parallel arrays aligned with DOM order:
 *   _last[i] — item i (signal mode: the same array object the signal holds)
 *   _rows[i] — row root node
 *   _keys[i] — key(_last[i]), built lazily on the first imperative op
 *
 * Fast paths (all O(1) or batch-native):
 *   append-all   — batch row renderer (mega-template cloning) into a
 *                  detached container or a single DocumentFragment insert
 *   replace-all  — detach container / replaceChildren(anchor, frag)
 *   clear        — parent.replaceChildren(anchor)
 *   swap/remove  — index scan + splice + direct DOM moves
 *   reorder      — general order pass (moves only where actually needed)
 *
 * Row renderers from `rowRenderer()` expose `.batch()`; the engine detects
 * it and builds rows in mega-template batches (one native cloneNode per ~50
 * rows) instead of per-row clones.
 */

import type { Signal, Sub } from './signal.ts';
import { owner } from './signal.ts';
import { ReFragment } from './fragment.ts';
import { popScope, pushScope, runCleanups } from './lifecycle.ts';

/** Row-scoped cleanup bags for rows whose render returned a plain node. */
const rowBags = new WeakMap<ChildNode, (() => void)[]>();

/** Dispose one row: fragment teardown, then its row bag (only when the view
 *  ever registered one — keeps the plain-row path WeakMap-free). */
function disposeRow(row: ChildNode, checkBags: boolean): void {
  (row as RowWithFr)._$fr?.dispose();
  if (checkBags) {
    const b = rowBags.get(row);
    if (b !== undefined) {
      rowBags.delete(row);
      runCleanups(b);
    }
  }
}

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

interface RowWithFr {
  _$fr?: ReFragment | null;
}

export class KeyedView<T> {
  readonly anchor: Node;

  private readonly _list: Signal<readonly T[]> | readonly T[];
  private readonly _isSig: boolean;
  private readonly _key: (item: T) => unknown;
  private readonly _render: (item: T) => Node;
  private readonly _batch: RowBatchFn<T> | null;
  l: readonly T[] = []; // items, aligned with r/k
  r: ChildNode[] = []; // row roots
  k: unknown[] | null = null; // keys (lazy)
  private _fr = false;
  private _bags = false;
  private _sub: Sub | null = null;
  private _m = false;
  private readonly _ctx = {};

  constructor(
    anchor: Node,
    list: Signal<readonly T[]> | readonly T[],
    key: (item: T) => unknown,
    render: (item: T) => Node,
  ) {
    this.anchor = anchor;
    this._list = list;
    this._isSig = isSig(list);
    this._key = key;
    this._render = render;
    this._batch = (
      typeof (render as unknown as { batch?: unknown }).batch === 'function'
        ? (render as unknown as { batch: RowBatchFn<T> }).batch
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

    // old is a strict prefix of next -> append the tail
    if (next.length > old.length) {
      let prefix = true;
      for (let i = 0; i < old.length; i++) {
        if (key(old[i]!) !== key(next[i]!)) {
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
    const rows = this.r;
    const x = ia < ib ? rows[ia]! : rows[ib]!; // earlier
    const y = ia < ib ? rows[ib]! : rows[ia]!; // later
    const yNext = y.nextSibling;
    const parent = this._pn;
    parent.insertBefore(y, x);
    parent.insertBefore(x, yNext);
    keys[ia] = kb;
    keys[ib] = ka;
    rows[ia] = y;
    rows[ib] = x;
    const arr = this.l as T[];
    const t = arr[ia]!;
    arr[ia] = arr[ib]!;
    arr[ib] = t;
  }

  /** Remove one row by key in O(1). Updates the source list in place. */
  remove(key: unknown): void {
    const keys = this._keys();
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== key) continue;
      const rows = this.r;
      const row = rows[i]!;
      if (this._fr || this._bags) disposeRow(row, this._bags);
      row.remove();
      keys.splice(i, 1);
      rows.splice(i, 1);
      (this.l as T[]).splice(i, 1);
      return;
    }
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

  private _create(item: T): ChildNode {
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
      this._fr = true;
      (root as RowWithFr)._$fr = r;
      return root;
    }
    if (bag !== null) {
      rowBags.set(r as ChildNode, bag);
      this._bags = true;
    }
    return r as ChildNode;
  }

  /** Build rows for items[start..) into `target`. */
  private _fill(target: ParentNode, items: readonly T[], start: number): void {
    const batch = this._batch;
    const rows = this.r;
    if (batch !== null) {
      batch(items, start, items.length - start, target, rows);
      return;
    }
    for (let i = start; i < items.length; i++) {
      const root = this._create(items[i]!);
      rows.push(root);
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
      batch(items, start, n, parent, rows);
    } else {
      const stage = detached ? null : document.createDocumentFragment();
      const target: ParentNode = detached ? parent : stage!;
      for (let i = start; i < items.length; i++) {
        const root = this._create(items[i]!);
        rows.push(root);
        target.appendChild(root);
      }
      if (!detached) parent.insertBefore(stage!, null);
    }
    if (detached) gp!.insertBefore(parent as Node, ref);
  }

  private _replaceAll(next: readonly T[]): void {
    const parent = this._pn;
    const rows = this.r;
    if (this._fr || this._bags) this._disposeAll();
    const ownedOnly =
      parent.childNodes.length === rows.length + 1 && this.anchor.parentNode === parent;
    rows.length = 0;
    this.k = null;
    if (ownedOnly) {
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
      for (let i = 0; i < rows.length; i++) rows[i]!.remove();
      this._fill(parent, next, 0);
    }
  }

  private _clear(): void {
    const parent = this._pn;
    const rows = this.r;
    if (this._fr || this._bags) this._disposeAll();
    if (parent.childNodes.length === rows.length + 1 && this.anchor.parentNode === parent) {
      parent.replaceChildren(this.anchor);
    } else {
      for (let i = 0; i < rows.length; i++) rows[i]!.remove();
    }
    this.r = [];
    this.k = null;
  }

  private _disposeAll(): void {
    const rows = this.r;
    if (this._fr || this._bags) {
      for (let i = 0; i < rows.length; i++) disposeRow(rows[i]!, this._bags);
    }
    this._fr = false;
    this._bags = false;
  }

  private _diff(next: readonly T[]): void {
    const key = this._key;
    const keys = this._keys();
    const rows = this.r;
    const parent = this._pn;

    const nextKeys = new Set<unknown>();
    for (let i = 0; i < next.length; i++) nextKeys.add(key(next[i]!));
    const kept = new Map<unknown, ChildNode>();
    for (let i = 0; i < keys.length; i++) {
      const kk = keys[i]!;
      if (nextKeys.has(kk)) kept.set(kk, rows[i]!);
      else {
        const row = rows[i]!;
        if (this._fr || this._bags) disposeRow(row, this._bags);
        row.remove();
      }
    }

    const nKeys: unknown[] = [];
    const nRows: ChildNode[] = [];
    let ref = this.anchor as ChildNode;
    for (let i = 0; i < next.length; i++) {
      const item = next[i]!;
      const kk = key(item);
      let row = kept.get(kk);
      if (row === undefined) row = this._create(item);
      if (ref.nextSibling !== row) parent.insertBefore(row, ref.nextSibling);
      nKeys.push(kk);
      nRows.push(row);
      ref = row;
    }
    this.k = nKeys;
    this.r = nRows;
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
  render: (item: T) => Node,
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
  remove(key: unknown): void;
  readonly size: number;
}

export function each<T>(
  list: Signal<readonly T[]> | readonly T[],
  key: (item: T) => unknown,
  render: (item: T) => Node,
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
    remove(key: unknown): void {
      dir._view?.remove(key);
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
  return dir._mount(a);
}
