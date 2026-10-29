/**
 * @zhenre/core — native Web Components integration
 *
 * Components ARE custom elements: zero new component model to learn, native
 * lifecycle, native DOM semantics, works with every HTML host environment.
 * Light DOM by default (global CSS just works); opt-in shadow via `{ shadow: true }`.
 */

import { popScope, pushScope, runCleanups } from './lifecycle.ts';

export interface ElementOptions {
  /** Attach a shadow root and render into it (default: light DOM). */
  shadow?: boolean;
}

/**
 * Define a native custom element whose content is built by `setup`.
 *
 * ```ts
 * defineElement('re-counter', (el, root) => {
 *   const count = signal(0);
 *   root.append(html`<button onclick=${() => count.value++}>count: ${count}</button>`);
 *   // optionally return a cleanup fn (runs on disconnect)
 *   return () => console.log('bye', el);
 * });
 * ```
 *
 * `root` is the render target: the element itself in light-DOM mode, or the
 * attached shadow root when `{ shadow: true }`.
 */
export function defineElement(
  tag: string,
  setup: (el: HTMLElement, root: ParentNode) => void | (() => void),
  opts?: ElementOptions,
): void {
  if (customElements.get(tag) !== undefined) return;

  class ReElement extends HTMLElement {
    #cleanups: (() => void)[] | null = null;
    #connected = false;

    connectedCallback(): void {
      if (this.#connected) return;
      this.#connected = true;
      const root =
        opts?.shadow === true ? this.attachShadow({ mode: 'open' }) : this;
      // setup body runs inside a cleanup context: onCleanup() calls there join
      // the returned cleanup fn on the same list, run on disconnect.
      const frame = pushScope();
      let result: void | (() => void);
      let bag: (() => void)[] | null = null;
      try {
        result = setup(this, root);
      } finally {
        bag = popScope(frame);
      }
      if (typeof result === 'function') {
        if (bag === null) bag = [result];
        else bag.push(result);
      }
      this.#cleanups = bag;
    }

    disconnectedCallback(): void {
      if (!this.#connected) return;
      this.#connected = false;
      const cleanups = this.#cleanups;
      this.#cleanups = null;
      runCleanups(cleanups);
    }
  }

  customElements.define(tag, ReElement);
}
