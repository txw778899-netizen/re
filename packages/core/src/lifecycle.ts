/**
 * @zhenre/core — cleanup contexts (lifecycle)
 *
 * A cleanup context is a list of teardown functions collected while a piece of
 * UI is being built. Contexts are opened by:
 *   - `defineElement` component setup (component lifetime)
 *   - keyed-list row renders (row lifetime)
 *   - `runWithCleanup` (any custom scope, e.g. @zhenre/store)
 *
 * `onCleanup(fn)` registers into the innermost open context. When the owner is
 * destroyed the functions run in registration order. Outside any context it is
 * a no-op (matching Solid semantics) — callers that must run cleanup regardless
 * keep the returned disposer themselves.
 *
 * Hot-path design (list rows render thousands of scopes per second):
 *   - scope frames come from a pool — opening a scope allocates nothing
 *   - the teardown bag is LAZY: an array exists only after the first
 *     `onCleanup` call, so rows that never register cleanup (the common case)
 *     cost one push + one pop, zero allocations
 */

type Bag = (() => void)[];

interface Frame {
  bag: Bag | null;
}

const stack: Frame[] = [];
const pool: Frame[] = [];

/** Open a cleanup scope. MUST be closed with `popScope(frame)`. */
export function pushScope(): Frame {
  const f = pool.pop();
  if (f !== undefined) {
    f.bag = null;
    stack.push(f);
    return f;
  }
  const fresh: Frame = { bag: null };
  stack.push(fresh);
  return fresh;
}

/**
 * Close a scope opened by `pushScope`. Returns the collected bag, or `null`
 * when nothing registered — the common case, allocated nowhere.
 */
export function popScope(f: Frame): Bag | null {
  stack.pop();
  pool.push(f);
  return f.bag;
}

/** The innermost open cleanup bag (used by `effect` for auto-registration). */
export function currentBag(): Bag | null {
  const f = stack[stack.length - 1];
  return f !== undefined ? f.bag : null;
}

/** Register teardown into the innermost open cleanup context (no-op outside).
 *  Materializes the scope's bag on first use. */
export function onCleanup(fn: () => void): void {
  registerCleanup(fn);
}

/** Like `onCleanup`, for internal hot callers (e.g. `effect` auto-registration). */
export function registerCleanup(fn: () => void): void {
  const f = stack[stack.length - 1];
  if (f === undefined) return;
  if (f.bag === null) f.bag = [fn];
  else f.bag.push(fn);
}

/**
 * Open a cleanup context for the duration of `fn`. Returns the collected bag
 * (`null` when nothing registered) plus the result. Convenience wrapper over
 * `pushScope`/`popScope` for non-hot custom scopes.
 */
export function runWithCleanup<T>(fn: () => T): { bag: Bag | null; result: T } {
  const f = pushScope();
  let bag: Bag | null;
  try {
    const result = fn();
    bag = f.bag;
    return { bag, result };
  } finally {
    popScope(f);
  }
}

/** Run every teardown in a bag (order of registration). Empties it. */
export function runCleanups(bag2: Bag | null): void {
  if (bag2 === null) return;
  for (let i = 0; i < bag2.length; i++) bag2[i]!();
  bag2.length = 0;
}
