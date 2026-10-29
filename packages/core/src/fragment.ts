/**
 * @zhenre/core — mounted template fragment
 *
 * A real DocumentFragment produced by the template engine (`html```) or by
 * row renderers. Lives in its own module so list views can brand-check rows
 * without pulling the template runtime into compiled bundles.
 *
 * Disposal fast path: the dominant row shape has exactly ONE binding to an
 * externally-owned signal (e.g. a keyed row label). For it, the signal/sub
 * pair is stored in dedicated fields and unlinked directly on dispose — no
 * closure, no array, no iterator. Rows with more external bindings spill the
 * extras into `disposers`.
 */

import type { ReOwner, Sub } from './signal.ts';

export class ReFragment extends DocumentFragment {
  root: Node | null = null;
  mounts: (() => void)[] | null = null;
  /** first externally-owned signal this fragment subscribes to */
  sig0: ReOwner | null = null;
  /** its subscription record (set iff `sig0` is set) */
  sub0: Sub | null = null;
  /** spill for 2nd+ external bindings and custom disposers */
  disposers: (() => void)[] | null = null;

  dispose(): void {
    const s = this.sub0;
    if (s !== null) {
      this.sub0 = null;
      (this.sig0 as ReOwner).$unsub(s);
    }
    const d = this.disposers;
    if (d !== null) {
      this.disposers = null;
      for (let i = 0; i < d.length; i++) d[i]!();
    }
  }
}
