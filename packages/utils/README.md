# @zhenre/utils

Timing, locking and micro helpers. Zero dependencies.

```ts
import { delay, debounce, throttle, dblock, rafThrottle, once, memoize, uid, clamp } from '@zhenre/utils';

await delay(200, abortController.signal);          // abortable sleep

const onResize = debounce(() => layout(), 100);    // .cancel() / .flush()
const onScroll = throttle(() => paint(), 50);      // leading + trailing
const load   = dblock(async (id) => fetchJSON(id)); // concurrent calls share the in-flight run
const paint  = rafThrottle(() => draw());          // one call per frame

const once  = once(() => heavyInit());
const get   = memoize((id: string) => load(id));
uid();                                             // collision-safe short id
clamp(5, 0, 10);
```

- `dblock` — re-entry lock: while a call is running, later calls receive the SAME promise instead of starting a second run. Rejection clears the lock.
- `debounce`/`throttle` preserve `this`; both expose `cancel()` (and `flush()`).
- Everything degrades gracefully outside browsers (rAF → `setTimeout(…, 16)`).

Build: `npm run build` (esbuild → `dist/`, tsc → types). Test: `npm test` (`node --test`).
