# @zhenre/store

Signal stores with real lifecycles. Zero dependencies (peer: `@zhenre/core`).

```ts
import { signal } from '@zhenre/core';
import { defineStore, useStore, destroyStore, onDestroy } from '@zhenre/store';

// global singleton — created once per id, shared everywhere
const useCounter = defineStore('counter', () => {
  const n = signal(0);
  const inc = () => n.value++;
  return { n, inc };
});
useCounter().inc();
destroyStore('counter'); // teardown + re-created on next use

// component-scoped — created per owner, destroyed automatically
defineElement('profile-card', (el, root) => {
  const profile = useStore(() => {
    const data = signal(null);
    effect(() => { /* auto-disposed when the component dies */ });
    onDestroy(() => socket.close()); // explicit teardown
    return { data };
  });
  root.append(html`<p>${profile.data}</p>`);
});
```

Scoping rules:

- `useStore` inside `defineElement` setup → destroyed on `disconnectedCallback`
- `useStore` inside a keyed-list row render → destroyed when the row is removed
- effects created in any store setup die with the store (core's cleanup contexts)
