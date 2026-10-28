# @zhenre/router

Minimal reactive client router. The current location IS a signal — templates update directly, no re-render, no diff. Zero dependencies (peer: `@zhenre/core`).

```ts
import { createRouter } from '@zhenre/router';
import { html } from '@zhenre/core';
import { animateEnter, animateLeave } from '@zhenre/animation';

const router = createRouter({
  mode: 'history', // or 'hash'
  routes: [
    { path: '/', name: 'home' },
    { path: '/user/:id', name: 'user' },
    { path: '*', name: '404' },
  ],
  guards: [
    async (to) => (to.path.startsWith('/admin') && !authed()) ? '/login' : undefined,
  ],
});
router.start();

// route is a signal — bind it straight into templates
document.body.append(html`<nav>${router.route.value.name}</nav>`);

// outlet with animation (both nodes in DOM during the transition)
router.outlet(
  document.getElementById('view')!,
  (m) => html`<h1>${m.params.id ?? m.route?.name}</h1>`,
  {
    transition: async (from, to) => {
      await Promise.all([animateLeave(from, 'fade'), animateEnter(to, 'fade')]);
    },
  },
);

await router.push('/user/42'); // guards → history → commit
```

- Matching: `/user/:id`, `*` wildcard (needs at least one segment), static outranks param outranks wildcard.
- Guards: run in order; `false` cancels (back-navigation reverts the URL), a string redirects (loop capped at 10), async supported.
- Navigation: `push` / `replace` return the committed `RouteMatch`; popstate flows through the same pipeline.
