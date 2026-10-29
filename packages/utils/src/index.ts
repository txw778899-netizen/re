/**
 * @zhenre/utils — timing, locking and micro helpers
 *
 * Design: each helper is a pure function over platform primitives
 * (setTimeout, requestAnimationFrame, Promise). No classes, no options
 * objects on the hot path, full inference for the wrapped callable.
 */

/* ------------------------------------------------------------------ */
/* delay                                                               */
/* ------------------------------------------------------------------ */

/**
 * Abortable sleep. Resolves after `ms`; rejects if `signal` aborts first.
 *
 * ```ts
 * await delay(200);
 * await delay(200, abortController.signal); // rejects on abort
 * ```
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const t = setTimeout(done, ms);
    function done(): void {
      cleanup();
      resolve();
    }
    function onAbort(): void {
      cleanup();
      reject(abortReason(signal!));
    }
    function cleanup(): void {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
    }
    signal?.addEventListener('abort', onAbort);
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason !== undefined ? signal.reason : new Error('[re] aborted');
}

/* ------------------------------------------------------------------ */
/* debounce / throttle                                                 */
/* ------------------------------------------------------------------ */

/** Debounced/throttled callable with manual control. */
export interface Controllable<F extends (...args: never[]) => void> {
  (...args: Parameters<F>): void;
  /** Drop the pending invocation. */
  cancel(): void;
  /** Run the pending invocation now (no-op if none). */
  flush(): void;
}

/**
 * Debounce: run `fn` once, `ms` after the LAST call. `this` is preserved.
 */
export function debounce<F extends (...args: any[]) => void>(fn: F, ms: number): Controllable<F> {
  let t: ReturnType<typeof setTimeout> | null = null;
  let pending: unknown[] | null = null;
  let self: unknown = null;
  const wrapped = function (this: unknown, ...args: unknown[]): void {
    self = this;
    pending = args;
    if (t !== null) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      const a = pending;
      pending = null;
      if (a !== null) fn.apply(self, a as any);
    }, ms);
  } as unknown as Controllable<F>;
  wrapped.cancel = () => {
    if (t !== null) clearTimeout(t);
    t = null;
    pending = null;
  };
  wrapped.flush = () => {
    if (t === null) return;
    clearTimeout(t);
    t = null;
    const a = pending;
    pending = null;
    if (a !== null) fn.apply(self, a as any);
  };
  return wrapped;
}

/**
 * Throttle: at most one call per `ms` window. Leading call is immediate;
 * the last call inside the window is kept and fired trailing.
 */
export function throttle<F extends (...args: any[]) => void>(fn: F, ms: number): Controllable<F> {
  let t: ReturnType<typeof setTimeout> | null = null;
  let pending: unknown[] | null = null;
  let self: unknown = null;
  const fire = (): void => {
    t = null;
    const a = pending;
    pending = null;
    if (a !== null) fn.apply(self, a as any);
  };
  const wrapped = function (this: unknown, ...args: unknown[]): void {
    self = this;
    if (t !== null) {
      pending = args;
      return;
    }
    fn.apply(self, args as any);
    t = setTimeout(fire, ms);
  } as unknown as Controllable<F>;
  wrapped.cancel = () => {
    if (t !== null) clearTimeout(t);
    t = null;
    pending = null;
  };
  wrapped.flush = () => {
    if (t === null) return;
    clearTimeout(t);
    fire();
  };
  return wrapped;
}

/* ------------------------------------------------------------------ */
/* dblock — re-entry lock                                              */
/* ------------------------------------------------------------------ */

/**
 * `dblock` (dedupe-block): wrap an async body so concurrent calls coalesce
 * onto the in-flight run. While a call is running, later calls receive the
 * SAME promise instead of starting a second run. Use it for "load once,
 * share in-flight work" patterns:
 *
 * ```ts
 * const load = dblock(async (id: string) => (await fetch(`/api/${id}`)).json());
 * const [a, b] = await Promise.all([load('1'), load('1')]); // one fetch
 * ```
 */
export function dblock<A extends unknown[], R>(
  fn: (...args: A) => R | Promise<R>,
): (...args: A) => Promise<R> {
  let running: Promise<R> | null = null;
  return (...args: A) => {
    if (running !== null) return running;
    running = Promise.resolve(fn(...args)).finally(() => {
      running = null;
    });
    return running;
  };
}

/* ------------------------------------------------------------------ */
/* rafThrottle                                                         */
/* ------------------------------------------------------------------ */

/** Raf-throttled callable: coalesces a burst of calls into one frame. */
export interface RafControllable<F extends (...args: any[]) => void> {
  (...args: Parameters<F>): void;
  cancel(): void;
}

/**
 * Coalesce calls to one per animation frame (leading slot of the frame).
 * Falls back to `setTimeout(…, 16)` where rAF is unavailable (tests, SSR).
 */
export function rafThrottle<F extends (...args: any[]) => void>(fn: F): RafControllable<F> {
  const raf: (cb: () => void) => number =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16) as unknown as number;
  const caf: (id: number) => void =
    typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (id) => clearTimeout(id);
  let id = 0;
  let pending: unknown[] | null = null;
  let self: unknown = null;
  const wrapped = function (this: unknown, ...args: unknown[]): void {
    self = this;
    pending = args;
    if (id === 0) {
      id = raf(() => {
        id = 0;
        const a = pending;
        pending = null;
        if (a !== null) fn.apply(self, a as any);
      });
    }
  } as unknown as RafControllable<F>;
  wrapped.cancel = () => {
    if (id !== 0) caf(id);
    id = 0;
    pending = null;
  };
  return wrapped;
}

/* ------------------------------------------------------------------ */
/* once / memoize / uid / clamp                                        */
/* ------------------------------------------------------------------ */

/** Run `fn` exactly once; later calls return the first result. */
export function once<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let done = false;
  let v: R;
  return (...args: A) => {
    if (!done) {
      done = true;
      v = fn(...args);
    }
    return v;
  };
}

/** Memoize by key (`keyFn` defaults to the first argument, reference-equal). */
export function memoize<A extends unknown[], R>(
  fn: (...args: A) => R,
  keyFn?: (...args: A) => unknown,
): (...args: A) => R {
  const cache = new Map<unknown, R>();
  return (...args: A) => {
    const k = keyFn !== undefined ? keyFn(...args) : args[0];
    let v = cache.get(k);
    if (v === undefined) {
      v = fn(...args);
      cache.set(k, v);
    }
    return v;
  };
}

let uidCounter = 0;

/** Short unique id: monotonic counter + random suffix (collision-safe). */
export function uid(): string {
  return (uidCounter++).toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Clamp `n` into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}
