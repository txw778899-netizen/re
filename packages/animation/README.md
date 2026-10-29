# @zhenre/animation

CSS-driven transitions and orchestration — animations are **defined in CSS**, JS only orchestrates. Vue-compatible class protocol, so existing Vue transition stylesheets work unchanged. Zero dependencies.

```css
.fade-enter-active, .fade-leave-active { transition: opacity .2s ease; }
.fade-enter-from, .fade-leave-to       { opacity: 0; }
```

```ts
import { animateEnter, animateLeave, animateSwap, stagger, flip } from '@zhenre/animation';

await animateEnter(row, 'fade');            // -enter-from → -enter-active → -enter-to
await animateLeave(row, 'fade'); row.remove();

await stagger(cards, 'fade', 30);           // inline transition-delay, restored after

// state switch — old + new both in the DOM ('together' parallel | 'out-in' sequential)
await animateSwap(oldView, newView, 'fade');
await animateSwap(oldView, newView, 'fade', 'out-in');

// FLIP: animate a keyed reorder with pure CSS transforms (WAAPI, compositor)
flip(rows, () => view.swap('a', 'b'), { duration: 250 });
```

Pair it with the router for animated route changes:

```ts
router.outlet(el, render, { transition: (a, b) => animateSwap(a, b, 'fade') });
```

Class protocol:

```
{name}-enter-from / {name}-enter-active / {name}-enter-to
{name}-leave-from / {name}-leave-active / {name}-leave-to
```

End detection listens `transitionend`/`animationend` guarded by a computed-duration timeout — it can neither hang (event lost) nor cut off early (no event).
