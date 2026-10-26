# ⚡ @zhenre — the smallest, fastest, most robust front-end framework with a first-class developer experience

> Native-platform feel with zero learning curve: **templates are real HTML, components are native Web Components, state is fine-grained signals.**
> Zero dependencies, zero VDOM, zero diffing. Full core is **≈4.8 KB min+brotli**; a tree-shaken benchmark bundle ships at **2.5 KB brotli**.

On the [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) (keyed, Chrome), **re** is the fastest implementation of its run — krausest, PR #2129.

Official-scale results (Chrome, keyed table of 200+ frameworks):

| Metric | Result |
| --- | --- |
| 9 CPU operations, geometric mean (vanilla = 1.000) | **0.950 — #1 of 202** |
| Columns ranked **#1** | 7 / 15 — create 1k **19.0 ms** · replace all **19.8 ms** · partial update **8.6 ms** · swap rows **10.6 ms** · append 1k **22.9 ms** · clear **6.8 ms** · memory after run **1.67 MB** |
| Remaining columns | create 10k **#2** · select **#5** · ready memory **#6** · run-clear memory **#8** · size **6.9 KB raw / 2.5 KB brotli** (#11 / #10) |
| vs. hand-written vanilla baseline | faster than vanilla on the geometric mean and on 6 of 9 CPU operations |

Numbers are calibrated against the official runner on a local paired A/B setup (multiple sessions merged); the official site re-runs on its own hardware after each merge, where re placed first with a 0.984 geomean in the Chrome 156 run.

---

## Quick start

```bash
npm create re@latest my-app
cd my-app && npm install && npm run dev
```

### 30-second tour

```ts
import { html, append, signal, defineElement } from '@zhenre/core';

// A component = a native custom element (no new component model, nothing to learn)
defineElement('re-counter', (el, root) => {
  const count = signal(0);
  root.append(html`
    <button onclick=${() => count.value++}>Clicked ${count} times</button>
  `);
  return () => console.log('cleanup on disconnect'); // optional cleanup
});

append(document.getElementById('app')!, html`<re-counter></re-counter>`);
```

- `${count}` binds the signal straight to a text node — an update **writes exactly that one text node**. No VDOM, no diffing, no scheduler.
- Templates compile once per call site and clone per instance: `content.cloneNode(true)` + slot positioning — the fastest tree-building primitive the browser offers.
- Lists use `each()`: an anchor-based keyed view. append / clear / replace run through O(1) container fast paths; selection / swap / remove expose O(1) direct operations.

## Packages (npm workspaces)

| Package | Description |
| --- | --- |
| [`@zhenre/core`](packages/core/) | Runtime: signals + `html` template engine + keyed each + defineElement |
| [`@zhenre/compiler`](packages/compiler/) | Template precompiler: JS reference implementation (parse5) + **native Zig compiler** + golden-fixture consistency tests against the browser |
| [`@zhenre/vite-plugin`](packages/vite-plugin/) | Vite integration: precompiles `html\`\`` at build time so the runtime skips parsing |
| [`create-re`](packages/create-re/) | Scaffolding CLI: `npm create re` (minimal / demo / bench templates, zero dependencies) |
| `bench/` | js-framework-benchmark-compliant implementation + the official vanilla baseline + full measurement harness |

## Engineering standards

- **TypeScript strict, fully typed** (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`); sources use erasable syntax only, tests run natively on Node
- **Testing**: `node --test` (zero test-framework dependencies); 58 assertions across signals / templates / lists / components / compiler consistency / plugin / CLI, plus 10 official-semantics smoke checks against the built bundle
- **Performance methodology**: same-machine, same-round paired A/B against the official vanilla baseline; 5 warm-up + 20 measured rounds; double-rAF timing including render; memory sampled after forced GC via CDP — see [`docs/benchmark.md`](docs/benchmark.md)
- **CI**: `.github/workflows/ci.yml` — lint-free build + full test suite + compiler consistency verification when Zig is available

## Documentation

- [Architecture decision records (ADR)](docs/architecture.md) — why a runtime-first design, why anchor-based keyed lists, why prototype-based signals
- [Benchmarks & reproduction](docs/benchmark.md) — methodology, data, how to rerun on your machine
- [Results](RESULTS.md)

## License

MIT
