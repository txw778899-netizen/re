# @zhenre Ecosystem Roadmap

> Implementation principles (unchanged): software-engineering discipline first —
> **minimal, fastest, most stable, best DX**. Every package: zero runtime
> dependencies, ESM + erasable-only TypeScript, tree-shakeable, `< 2KB` min+gz,
> tested with `node --test` + happy-dom.

## Why an ecosystem, and why it stays small

A tiny kernel builds large projects when three conditions hold:

```
large app = small kernel × strong conventions × full ecosystem
```

- The **kernel** (core: signals, templates, keyed lists) decides the performance
  floor. It must never grow.
- **Conventions** are encoded in scaffolding and types, not in the runtime.
- The **ecosystem** covers the positions large frameworks bundle by default —
  but each piece stays opt-in, independently versioned, and independently
  loadable. Nothing here is loaded unless you import it.

## Package matrix

| Package              | Role                                                        | Depends on       | Size budget (min+gz) |
| -------------------- | ----------------------------------------------------------- | ---------------- | -------------------- |
| `@zhenre/core`       | signals, `html`, `defineElement`, keyed lists, `onCleanup`  | —                | ~4KB (done, 0.3.0)   |
| `@zhenre/utils`      | `delay` `debounce` `throttle` `dblock` `rafThrottle` …      | —                | < 1KB                |
| `@zhenre/animation`  | CSS-driven enter/leave, FLIP reorder, stagger orchestration | —                | < 1.5KB              |
| `@zhenre/store`      | global + component-scoped stores, auto-destroy on unmount   | core             | < 1KB                |
| `@zhenre/router`     | history/hash routes, params, guards, outlet × animation     | core (animation optional) | < 2KB          |
| `@zhenre/request`    | axios-like fetch client: interceptors, timeout, params      | —                | < 2KB                |
| `@zhenre/message`    | typed `postMessage` protocol: pub/sub + request/reply       | —                | < 1.2KB              |
| `@zhenre/form`       | signal two-way binding, validation, touched/dirty/submit    | core             | < 1.5KB              |

Total ecosystem budget (excluding core): **< 10KB min+gz** for everything,
installed à la carte.

## API contracts (v0.1.0)

### @zhenre/utils

```ts
delay(ms, signal?): Promise<void>          // abortable sleep
debounce(fn, ms): Debounced                // .cancel() .flush()
throttle(fn, ms): Throttled                // trailing call kept, .cancel()
dblock(fn): (...args) => Promise           // re-entry lock: concurrent calls
                                           // coalesce onto the in-flight run
rafThrottle(fn): RafThrottled              // coalesce to one animation frame
once(fn), memoize(fn, keyFn?), uid(), clamp(n, min, max)
```

### @zhenre/animation — fully CSS-driven

Animations are *defined* in CSS (classes + keyframes); JS only orchestrates.
Class protocol is Vue-compatible, so existing Vue transition stylesheets work:

```
{name}-enter-from / {name}-enter-active / {name}-enter-to
{name}-leave-from / {name}-leave-active / {name}-leave-to
```

```ts
animateEnter(el, name): Promise<void>      // resolves on end event or duration fallback
animateLeave(el, name): Promise<void>
animateSwap(from, to, name, mode?): Promise<void>  // state switch: 'together' parallel
                                                   // or 'out-in' sequential; pairs with
                                                   // router.outlet's transition hook
stagger(els, name, step?, from?): Promise<void[]>   // inline per-element delay, cleaned up after
flip(els, mutate, {duration?, easing?}): Promise<void>  // FLIP reorder via WAAPI transforms
```

Scenario coverage: enter (mount), leave (pre-destroy), swap (state switch),
stagger/flip (orchestration). Single-element class toggles need no JS at all —
flip the class and CSS animates, which is the point of being CSS-only.

End detection: listen `transitionend`/`animationend`, guarded by a timeout
derived from computed durations — never hangs, never fires early.

### @zhenre/store

```ts
defineStore(id, setup): () => T    // global singleton keyed by id
useStore(setup): T                 // scoped to the enclosing component or list row;
                                   // destroyed automatically via core onCleanup
onDestroy(fn): void                // register teardown inside store setup
destroyStore(id): boolean          // manual global destroy (re-creates on next use)
```

Mechanics: store setup runs inside a core cleanup context, so `effect()` and
signal subscriptions created in a store die with the store. Component-scoped
stores register their teardown through `core.onCleanup` — components destroy
them on `disconnectedCallback`, keyed-list rows destroy them on row removal.

### @zhenre/router

```ts
createRouter({ mode: 'history' | 'hash', routes, guards?, base? }): Router
router.route: Signal<RouteMatch>           // reactive — drives html`` templates directly
router.push(to) / router.replace(to): Promise<RouteMatch>
router.resolve(path): RouteMatch
router.outlet(el, render(m), { transition?(from, to) }): () => void
```

- Matching: `/user/:id`, `*` wildcard, static segments win over params.
- Guards run in order; return `false` to cancel, a string to redirect
  (redirect loop capped at 10). Async guards supported.
- `outlet` pairs with `@zhenre/animation`: pass a `transition(from, to)`
  callback (typically `animateLeave` + `animateEnter`) for animated route
  swaps; stale async renders are token-guarded.

### @zhenre/request — axios-shaped, fetch-native

```ts
request(config) / request.get(url, config?) / .post(url, body, config?) …
create(defaults): Instance                 // instance defaults + interceptors
inst.before.use(cfg => cfg)                // request interceptors (LTR)
inst.after.use(res => res)                 // response interceptors (LTR)
inst.errors.use(err => err)                // error interceptors
// timeout via AbortController; params serialization; JSON auto-handling;
// RequestError { status, data, config, isTimeout }
```

### @zhenre/message — postMessage protocol

```ts
createChannel(target, { origin?, name?, listen? }): Channel
ch.send(topic, payload)                    // fire-and-forget pub
ch.on(topic, fn): () => void               // fn's return value becomes the reply
ch.ask<R>(topic, payload, timeoutMs?): Promise<R>   // request/reply with id + timeout
ch.close()
```

Wire format: `{ v: 1, ch, id?, t: 'pub'|'req'|'res', topic, p, e? }`.
Origin-allowlisted by default; works across `Window`, `Worker`, `MessagePort`.

### @zhenre/form

```ts
bind(input, signal): () => void            // two-way binding (checkbox→bool, number→number)
createForm(rootEl, { validators?, onSubmit? }): FormState
form.field(name): { value, error, touched } // all signals — template-reactive
form.valid / form.dirty                     // computed
form.submit(): Promise<values | null>       // validates; focuses nothing, rejects nothing
form.reset() / form.destroy()
```

Validation triggers on `input` after first `blur` (touched protocol), and on
every `submit`. Validators are sync or async, per-field, receive all values.

## Sequencing

1. **core 0.3.0** — `onCleanup` + component/row cleanup contexts (the only
   kernel addition the ecosystem needs; ~20 lines, zero hot-path cost).
2. `utils` → `animation` → `store` → `router` (dependency order).
3. `request`, `message`, `form` (independent, any order).
4. Sizes measured, README ecosystem section, monorepo build wiring.
5. Publish `@zhenre/*` 0.1.0 + `@zhenre/core` 0.3.0 (manual, token holder).

## Non-goals (deliberate)

- No SSR/meta-framework in this pass — `create-re` templates + vite-plugin
  already cover SPA; SSR is a separate track once the ecosystem is stable.
- No JSX, no VDOM, no scheduler: the kernel's push-based signals are the
  concurrency model.
- No animation engine (tweening/spring JS): everything CSS/WAAPI-native.
