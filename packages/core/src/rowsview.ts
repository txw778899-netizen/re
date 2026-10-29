/**
 * @zhenre/core — DOM-anchored list view (zero per-row JS state)
 *
 * The leanest way to drive a keyed row list: the parent element (e.g. a
 * `<tbody>`) IS the state. The view keeps no item arrays, no row arrays and
 * no per-row bookkeeping — rows are discovered from `parent.children`, so a
 * build/append/cycle retains exactly nothing beyond the view itself.
 *
 * This is the shape the fastest hand-written reference implementations use,
 * provided here as a first-class engine mode (batch renderer protocol, large
 * builds detached from layout, O(1) clear/swap/remove). Use `mountList()` /
 * `KeyedView` when you want the engine to reconcile a data array instead.
 *
 * Contract: `parent` is managed exclusively by the view — every child of
 * `parent` is a row (`parent.children`). `clear()` empties the parent.
 */

/** Fill `n` freshly rendered rows into `target` (appended at the end). */
export type RowsFillFn = (n: number, target: ParentNode) => void;

export interface RowsView {
  /** Number of live rows (== parent.children.length). */
  readonly size: number;
  /** (Re)build exactly `n` rows, replacing any existing rows. */
  build(n: number): void;
  /** Append `n` rows after the current ones. */
  append(n: number): void;
  /** Remove all rows (O(1) container swap). */
  clear(): void;
  /** Swap two rows in O(1) (DOM node identity is preserved). */
  swapAt(a: number, b: number): void;
  /** Remove the row at index i (O(1) node removal). */
  removeAt(i: number): void;
}

export function mountRows(parent: Element, fill: RowsFillFn): RowsView {
  // whitespace-only text siblings would disable the O(1) container paths
  {
    let c = parent.firstChild;
    while (c !== null) {
      const next = c.nextSibling;
      if (c.nodeType === 3 && (c as Text).data.trim() === '') {
        parent.removeChild(c);
      }
      c = next;
    }
  }

  const isEmpty = () => parent.firstChild === null;

  // anchor-free empty container + large batch -> build inside the detached
  // container (skips per-insert layout invalidation), then reinsert once
  const appendAll = (n: number): void => {
    const gp = parent.parentNode;
    if (gp !== null && n >= 32 && parent.isConnected && isEmpty()) {
      const ref = parent.nextSibling;
      gp.removeChild(parent);
      fill(n, parent);
      gp.insertBefore(parent, ref);
    } else {
      fill(n, parent);
    }
  };

  return {
    get size() {
      return parent.children.length;
    },
    build(n: number) {
      if (!isEmpty()) parent.replaceChildren();
      if (n > 0) appendAll(n);
    },
    append(n: number) {
      if (n <= 0) return;
      if (isEmpty()) {
        appendAll(n);
      } else {
        const frag = document.createDocumentFragment();
        fill(n, frag);
        parent.insertBefore(frag, null);
      }
    },
    clear() {
      parent.replaceChildren();
    },
    swapAt(a: number, b: number) {
      if (a === b) return;
      const kids = parent.children;
      const x = kids[a] as ChildNode | undefined;
      const y = kids[b] as ChildNode | undefined;
      if (x === undefined || y === undefined) return;
      // classic two-step swap (both nodes stay in the document)
      const yNext = y.nextSibling;
      parent.insertBefore(y, x);
      parent.insertBefore(x, yNext);
    },
    removeAt(i: number) {
      (parent.children[i] as ChildNode | undefined)?.remove();
    },
  };
}
