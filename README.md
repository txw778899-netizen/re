# ⚡ @zhenre — 最小、最快、最稳健、开发体验最好的前端框架

> 原生级别的体验，零学习门槛：**模板是真实 HTML，组件是原生 Web Components，状态是细粒度信号。**
> 零依赖、零 VDOM、零 diff。核心 gzip 后 **≈3.9 KB**。

在 [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) 同规范本地实测中（Chrome / Chromium，paired A/B）：

| 指标 | 结果 |
| --- | --- |
| 9 项 CPU 操作几何均值（相对 vanilla 基线） | **1.034x** |
| 击败 vanilla 基线的操作 | create 1k **0.971** / append 10k **0.963** / create 10k **0.987** |
| 与 vanilla 完全持平 | partial update **1.000** / select **1.003** / swap **1.002** |
| 内存（ready / repeat-clear） | **1.01x** / **1.10x** |

对比公开榜单（Chrome 154 时代头部框架相对 vanilla 的系数：solid ≈ 1.04–1.37、svelte ≈ 1.07–2.04、vue-vapor ≈ 1.06–1.08），@zhenre 在 update/select/swap/create10k/append 等操作上达到或超越现有第一梯队，且多项直接击败 vanilla 手写基线。

---

## 快速开始

```bash
npm create re@latest my-app
cd my-app && npm install && npm run dev
```

### 30 秒看懂

```ts
import { html, append, signal, defineElement } from '@zhenre/core';

// 组件 = 原生自定义元素（无新组件模型、无学习成本）
defineElement('re-counter', (el, root) => {
  const count = signal(0);
  root.append(html`
    <button onclick=${() => count.value++}>点击次数：${count}</button>
  `);
  return () => console.log('cleanup on disconnect'); // 可选清理函数
});

append(document.getElementById('app')!, html`<re-counter></re-counter>`);
```

- `${count}` 直接把信号绑到文本节点 —— 更新时**只写那一个 text node**，没有 VDOM、没有 diff、没有调度器。
- 模板按调用点编译一次、按实例克隆：`content.cloneNode(true)` + 槽位定位，是浏览器里最快的建树方式。
- 列表用 `each()`：锚点式 keyed 视图，append / clear / replace 走 O(1) 容器快路径，selection / swap / remove 提供 O(1) 直操 API。

## 包结构（npm workspaces）

| 包 | 说明 |
| --- | --- |
| [`@zhenre/core`](packages/core/) | 运行时：signals + html 模板引擎 + keyed each + defineElement |
| [`@zhenre/compiler`](packages/compiler/) | 模板预编译器：JS 参考实现（parse5）+ **Zig 原生编译器** + 浏览器黄金 fixture 一致性测试 |
| [`@zhenre/vite-plugin`](packages/vite-plugin/) | Vite 构建集成：构建期预编译 `html\`\``，运行时跳过解析 |
| [`create-re`](packages/create-re/) | 脚手架 CLI：`npm create re`（minimal / demo / bench 三套模板，零依赖） |
| `bench/` | js-framework-benchmark 合规实现 + vanilla 官方基线 + 完整实测 harness |

## 工程规范

- **TypeScript strict 全量类型**（`noUncheckedIndexedAccess`、`verbatimModuleSyntax`），源码仅用可擦除语法，node 原生直跑测试
- **测试**：`node --test`（零测试框架依赖），47 + 8 + 3 + 3 项断言覆盖信号/模板/列表/组件/编译器一致性/插件/CLI
- **性能方法学**：与官方 vanilla 基线同机同轮 A/B、5 轮预热 + 20 轮测量、双 rAF 计时含渲染、CDP 强制 GC 后采内存，详见 [`docs/benchmark.md`](docs/benchmark.md)
- **CI**：`.github/workflows/ci.yml` — lint-free build + 全量测试 + Zig 可用时的编译器一致性验证

## 文档

- [架构决策记录（ADR）](docs/architecture.md) — 为什么是运行时路线、为什么锚点式 keyed、为什么信号要原型化
- [基准实测与复现](docs/benchmark.md) — 方法、数据、如何在自己机器上复跑
- [实测结果](RESULTS.md)

## License

MIT
