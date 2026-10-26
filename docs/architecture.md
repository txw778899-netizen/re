# @zhenre 架构决策记录（ADR）

本文记录 @zhenre 的关键技术决策、备选方案与取舍理由。

## ADR-001 运行时路线 + Web Components 组件模型

**决策**：不做编译器依赖的核心（可选预编译器仅作加速），组件模型直接采用原生 Custom Elements。

**备选**：
- 编译器路线（Solid/Svelte 式）：性能上限相同，但引入学习门槛与工具链耦合；
- VDOM 路线（Vue/React 式）：update/select 类操作天然多一次 diff + 调度，实测中该类操作正是 @zhenre 与 vanilla 完全持平、而头部 VDOM 框架落后 20%–300% 的原因。

**理由**：
1. 「无学习门槛」是明确需求——会写 HTML 就会写 @zhenre 模板，会写自定义元素就写 @zhenre 组件；
2. 细粒度信号 + 直接 DOM 更新在 benchmark 的 update/select/swap 操作上可达 vanilla 水平（实测 1.000–1.003x），这是 VDOM 架构无法达到的；
3. 运行时模板编译缓存（按调用点一次）成本仅在首帧，且可被预编译器完全消除（ADR-004）。

**代价**：标签模板首帧需一次解析（约 0.1ms/模板）；组件生命周期遵循原生回调（connectedCallback 语义），不提供额外的类 React 生命周期。

## ADR-002 锚点式 keyed 列表（anchored keyed view）

**决策**：`each(list, key, render)` 在子位置插入一个标记节点作为锚点，视图持有 `Map<key, entry>`，所有操作用直接 DOM 原语完成。

**核心设计**：
- **O(1) 容器快路径**（附守卫条件）：
  - 清空：`parent.replaceChildren(anchor)`；
  - 全量替换（新旧无公共 key）：`parent.replaceChildren(anchor, frag)`；
  - 尾部追加（旧数组是新数组前缀）：DocumentFragment 一次插入；大批量时**摘下容器构建再插回**（与官方 vanilla 基线同款技巧，实测 create10k 因此反超 vanilla）；
- **O(1) 直操 API**：`view.swap(k1,k2)`（两次 insertBefore + `compareDocumentPosition` 定序）、`view.remove(key)`、`view.ref(key)`——selection 高亮等命令式场景零响应式开销；
- **声明式同步**：数组 signal 变化触发 sync，自动命中上述快路径或进入通用 keyed diff（O(n) 比较、只移动乱序节点）；
- **容器规范化**：挂载时清除容器内纯空白文本节点——HTML 源码里的换行缩进会让 `childNodes.length` 永不匹配，从而悄悄废掉所有 O(1) 快路径（这是实测中发现的真实坑）。

**备选**：lit 的 repeat 指令（基于 LIS 的重排，实现复杂）、Solid 的 `<For>`（引用 diff）。锚点方案的快路径集合精确覆盖 benchmark 的全部 9 类操作，且实现量最小（约 400 行）。

## ADR-003 信号：原型类 + 单订阅内联 + 归属标记

**决策**：
1. `signal/computed` 用**原型类**实现而非对象字面量工厂——每实例仅 `_v/_subs/_own` 三个字段，万级行 × 每格信号时显著降低分配与 GC 压力（实测 run-memory 从 2.04x 降到 1.39x）；
2. **单订阅内联**：`_sub0` 直存第一个订阅者，第二个订阅者才分配数组——每格恰好一个文本绑定的场景（最常见）零数组分配；
3. **归属标记**：行渲染期间创建的信号标记 `_own = view 上下文`；绑定订阅这类信号时**跳过退订清理**——行销毁时信号与订阅者同生共死，清理是纯浪费（clear 10k 因此省掉 ~15ms 的退订循环）。全局信号的订阅仍走完整清理，杜绝泄漏。

**同步通知（无调度器）**：signal 写入立即通知 DOM 订阅者直接写 `text.data`。benchmark 的 partial update（1000 个文本节点更新）实测与 vanilla 的裸 `nodeValue` 写入完全持平（1.000x）——任何调度/批处理层都会破坏这一结果。需要原子更新时提供 `batch()`。

## ADR-004 模板预编译器（Zig）与三级编译策略

**决策**：模板编译产出「槽位描述符」（`{html, slots[]}`），支持三级获取：
1. 运行时编译（默认）：`template.innerHTML` + TreeWalker，按调用点缓存；
2. 构建期 JS 预编译：`@zhenre/vite-plugin` 用 acorn 找到 `html\`\`` 调用，`@zhenre/compiler`（parse5，与浏览器同规范）产出描述符，运行时 `__wireTemplate` 直接消费；
3. 构建期 Zig 原生编译：`zig/re_template.zig`，供追求极致构建速度的链路使用。

**一致性工程**：`fixtures/expected.json` 是**从真实 Chromium 生成的黄金标准**（运行时编译器 = 真值），JS 参考实现与 Zig 实现都必须与之逐槽位一致（parity 测试）。没有 DOM 的构建环境因此不可能产出与浏览器不一致的描述符——这是「稳健」的关键保障。

**预编译运行时的一个隐性陷阱**：HTML 解析器会合并相邻文本节点，而槽位路径指向「拆分后」的结构。运行时编译路径天然已拆分；预编译路径必须对模板 content 做一次性规范化（`normalizeContent`），否则克隆体定位失败。该问题在插件测试中被捕获并修复。

## ADR-005 基准测试方法学

**决策**：与官方 vanilla 基线同机 A/B，`click → 双 rAF` 计时（含渲染），5 轮预热 + 20 轮测量（无预热操作按官方语义每轮重载页面），实现顺序逐轮交替，CDP `Performance.getMetrics` + 强制 GC 采内存。

**教训（实测中踩过）**：
- 同源双页面在 Chromium 中共**享渲染进程主线程**——配对并行测量互相污染计时窗口，必须顺序测量；
- 官方语义是「同一页面预热后连测」，每轮冷重启测的是首击性能，会系统性放大冷启动差距；
- vanilla 自己的数字在沙箱上轮间波动可达 ±15%，结论必须基于多轮聚合。

**结果**：geomean 1.034x，三项操作击败 vanilla（create1k 0.971 / append 0.963 / run10k 0.987），三项精确持平（1.000–1.003）。逐项数据见 [RESULTS.md](../RESULTS.md)。
