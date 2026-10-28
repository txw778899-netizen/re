/**
 * @zhenre/animation — CSS-driven transitions and orchestration
 *
 * Animations are DEFINED in CSS (classes + keyframes); this module only
 * orchestrates them. No tweening, no JS-per-frame work, no dependencies.
 *
 * Class protocol (Vue-compatible — reuse your existing transition stylesheets):
 *
 *   {name}-enter-from    start state, present for one frame
 *   {name}-enter-active  transition/animation properties live here
 *   {name}-enter-to      target state, present until done
 *   {name}-leave-*       same shape for leave
 *
 * ```css
 * .fade-enter-active, .fade-leave-active { transition: opacity .2s ease; }
 * .fade-enter-from, .fade-leave-to { opacity: 0; }
 * ```
 *
 * ```ts
 * append(list, row);                    await animateEnter(row, 'fade');
 * await animateLeave(row, 'fade'); row.remove();
 * await animateSwap(oldView, newView, 'fade');      // state switch
 * ```
 *
 * End detection listens `transitionend`/`animationend` (capture, first hit
 * wins) guarded by a timeout derived from computed durations — so it can
 * neither hang (no event) nor fire early (event lost). Stagger sets inline
 * `transition-delay`/`animation-delay` and restores them afterwards. FLIP
 * plays CSS `transform` through the native Web Animations API (compositor
 * work, zero JS per frame).
 */

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

const raf: (cb: () => void) => number =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb) => setTimeout(cb, 16) as unknown as number;

function nextFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (): void => {
      if (--n <= 0) resolve();
      else raf(step);
    };
    raf(step);
  });
}

/** Max of transition/animation durations in ms (computed, comma lists). */
function durationOf(el: Element): number {
  const cs = getComputedStyle(el);
  return Math.max(parseDur(cs.transitionDuration), parseDur(cs.animationDuration));
}

function parseDur(v: string): number {
  if (v === '') return 0;
  let out = 0;
  const parts = v.split(',');
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i]!.trim();
    const n = parseFloat(s);
    if (Number.isNaN(n)) continue;
    const ms = s.endsWith('ms') ? n : n * 1000;
    if (ms > out) out = ms;
  }
  return out;
}

/** Resolve on first end event, or after fallbackMs (+ slack). Never hangs. */
function whenDone(el: Element, fallbackMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      el.removeEventListener('transitionend', finish, true);
      el.removeEventListener('animationend', finish, true);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, fallbackMs + 64);
    el.addEventListener('transitionend', finish, true);
    el.addEventListener('animationend', finish, true);
  });
}

/* ------------------------------------------------------------------ */
/* enter / leave                                                       */
/* ------------------------------------------------------------------ */

/** Play the `{name}-enter-*` transition on `el`; resolves when done. */
export async function animateEnter(el: Element, name: string): Promise<void> {
  const from = `${name}-enter-from`;
  const active = `${name}-enter-active`;
  const to = `${name}-enter-to`;
  el.classList.add(from, active);
  await nextFrames(2);
  const dur = durationOf(el);
  el.classList.remove(from);
  el.classList.add(to);
  await whenDone(el, dur);
  el.classList.remove(active, to);
}

/**
 * Play the `{name}-leave-*` transition on `el`; resolves when done.
 * Removal of `el` is the caller's job (`await animateLeave(el, n); el.remove()`)
 * — or use the same pattern inside a keyed view's leave flow.
 */
export async function animateLeave(el: Element, name: string): Promise<void> {
  const from = `${name}-leave-from`;
  const active = `${name}-leave-active`;
  const to = `${name}-leave-to`;
  el.classList.add(active, from);
  await nextFrames(2);
  const dur = durationOf(el);
  el.classList.remove(from);
  el.classList.add(to);
  await whenDone(el, dur);
  el.classList.remove(active, to);
}

/* ------------------------------------------------------------------ */
/* state switch                                                        */
/* ------------------------------------------------------------------ */

/** How the two sides of a state switch overlap. */
export type SwapMode = 'together' | 'out-in';

/**
 * State switch: old and new nodes are BOTH in the DOM (append `to` first).
 * Plays `{name}-leave-*` on `from` and `{name}-enter-*` on `to`:
 *   - `'together'` (default) — in parallel, no layout gap (in-out feel)
 *   - `'out-in'` — leave settles first, enter starts after (no overlap)
 * Removing `from` is the caller's job — or `router.outlet(el, render,
 * { transition: (a, b) => animateSwap(a, b, 'fade') })` does it for you.
 * Pure state toggles on ONE element need no JS: flip a class, CSS animates.
 */
export function animateSwap(
  from: Element,
  to: Element,
  name: string,
  mode: SwapMode = 'together',
): Promise<void> {
  if (mode === 'out-in') {
    return animateLeave(from, name).then(() => animateEnter(to, name));
  }
  return Promise.all([animateLeave(from, name), animateEnter(to, name)]).then(
    () => undefined,
  );
}

/* ------------------------------------------------------------------ */
/* stagger                                                             */
/* ------------------------------------------------------------------ */

/**
 * Enter every element with an incremental delay (inline CSS
 * `transition-delay`/`animation-delay`, restored after each finishes).
 * step in ms, `from` is the delay of the first element.
 */
export function stagger(
  els: Iterable<Element>,
  name: string,
  step = 30,
  from = 0,
): Promise<void[]> {
  let i = 0;
  const jobs: Promise<void>[] = [];
  for (const el of els) {
    const d = `${from + i++ * step}ms`;
    const st = (el as HTMLElement).style;
    const prevT = st.transitionDelay;
    const prevA = st.animationDelay;
    st.transitionDelay = d;
    st.animationDelay = d;
    jobs.push(
      animateEnter(el, name).then(() => {
        if (st.transitionDelay === d) st.transitionDelay = prevT;
        if (st.animationDelay === d) st.animationDelay = prevA;
      }),
    );
  }
  return Promise.all(jobs);
}

/* ------------------------------------------------------------------ */
/* FLIP                                                                */
/* ------------------------------------------------------------------ */

export interface FlipOptions {
  /** Move duration in ms (default 200). */
  duration?: number;
  /** CSS easing for the move (default `ease`). */
  easing?: string;
}

/**
 * FLIP (First–Last–Invert–Play) for reorder/layout changes:
 * capture positions, run `mutate()` (DOM changes, may be async), then play
 * the inverted delta as a native CSS transform animation. Perfect for
 * animating keyed-list swaps without re-rendering.
 *
 * ```ts
 * flip(rows, () => view.swap('a', 'b'), { duration: 250 });
 * ```
 */
export function flip(
  els: Iterable<Element>,
  mutate: () => void | Promise<void>,
  opts?: FlipOptions,
): Promise<void> {
  const list = Array.from(els);
  const first = new Map<Element, { x: number; y: number }>();
  for (let i = 0; i < list.length; i++) {
    const r = list[i]!.getBoundingClientRect();
    first.set(list[i]!, { x: r.left, y: r.top });
  }
  const play = (): Promise<void> => {
    const anims: Promise<unknown>[] = [];
    for (let i = 0; i < list.length; i++) {
      const el = list[i]!;
      const f = first.get(el)!;
      const r = el.getBoundingClientRect();
      const dx = f.x - r.left;
      const dy = f.y - r.top;
      if (dx === 0 && dy === 0) continue;
      const animate = (el as HTMLElement).animate;
      if (typeof animate !== 'function') continue;
      anims.push(
        animate
          .call(
            el,
            [
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: 'translate(0px, 0px)' },
            ],
            { duration: opts?.duration ?? 200, easing: opts?.easing ?? 'ease' },
          )
          .finished.catch(() => undefined),
      );
    }
    return Promise.all(anims).then(() => undefined);
  };
  const m = mutate();
  if (m instanceof Promise) return m.then(play);
  return play();
}
