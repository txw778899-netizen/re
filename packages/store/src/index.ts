/**
 * @zhenre/store — signal stores with real lifecycles
 *
 * Two creation modes, one teardown contract:
 *
 *   defineStore(id, setup)  → global singleton keyed by `id`;
 *                             destroyStore(id) tears it down (next access
 *                             re-creates it).
 *   useStore(setup)         → scoped to the enclosing owner: a component
 *                             (defineElement setup), a keyed-list row render,
 *                             or any custom runWithCleanup context. Destroyed
 *                             automatically when the owner dies.
 *
 * Inside a store setup, resources just work:
 *   - `effect(...)` registers itself — it dies with the store (no boilerplate)
 *   - `onDestroy(fn)` registers explicit teardown (timers, sockets, observers)
 *
 * ```ts
 * const useCounter = defineStore('counter', () => {
 *   const n = signal(0);
 *   const inc = () => n.value++;
 *   return { n, inc };
 * });
 * ```
 */

import { onCleanup, runCleanups, runWithCleanup } from '@zhenre/core';

interface Entry {
  store: object;
  bag: (() => void)[] | null;
}

const registry = new Map<string, Entry>();

/** Register teardown for the store (or owner) currently being created. */
export function onDestroy(fn: () => void): void {
  onCleanup(fn);
}

/**
 * Global singleton store: `setup` runs once per `id`, its result is cached
 * and shared by every caller. Returns the accessor function.
 */
export function defineStore<T extends object>(id: string, setup: () => T): () => T {
  return () => {
    let e = registry.get(id);
    if (e === undefined) {
      const out = runWithCleanup(setup);
      e = { store: out.result as object, bag: out.bag };
      registry.set(id, e);
    }
    return e.store as T;
  };
}

/**
 * Destroy a global store created by `defineStore(id)`: runs teardown in
 * registration order and forgets the instance. The next `use` re-creates it.
 * Returns whether an instance existed.
 */
export function destroyStore(id: string): boolean {
  const e = registry.get(id);
  if (e === undefined) return false;
  registry.delete(id);
  runCleanups(e.bag);
  return true;
}

/**
 * Component/row-scoped store: created once per owner, destroyed automatically
 * when the owner dies (component disconnect, row removal, context teardown).
 * Call it inside `defineElement` setup or a list row render.
 */
export function useStore<T extends object>(setup: () => T): T {
  const out = runWithCleanup(setup);
  onCleanup(() => runCleanups(out.bag));
  return out.result;
}
