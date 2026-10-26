/**
 * @zhenre/core — mounted template fragment
 *
 * A real DocumentFragment produced by the template engine (`html```) or by
 * row renderers. Lives in its own module so list views can brand-check rows
 * without pulling the template runtime into compiled bundles.
 */

export class ReFragment extends DocumentFragment {
  root: Node | null = null;
  disposers: (() => void)[] | null = null;
  mounts: (() => void)[] | null = null;

  dispose(): void {
    const d = this.disposers;
    if (d !== null) {
      this.disposers = null;
      for (let i = 0; i < d.length; i++) d[i]!();
    }
  }
}
