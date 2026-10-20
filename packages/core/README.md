# @re/core

细粒度信号 + 真实 HTML 模板 + 锚点式 keyed 列表 + 原生 Web Components。
零依赖，gzip ≈ 3.9KB。TypeScript strict，可擦除语法（node 原生可跑）。

## API 一览

```ts
import {
  // 响应式
  signal, computed, effect, batch, untrack, isSignal,
  // 模板
  html, append,
  // 列表
  each,
  // 组件
  defineElement,
} from '@re/core';
```

### signal

```ts
const count = signal(0);
count.value;            // 读（自动依赖收集）
count.value = 1;        // 写（同步通知）
count.peek();           // 免收集读取
count.setQuiet(2);      // 静默写（直接 DOM 场景）
```

### computed / effect / batch

```ts
const double = computed(() => count.value * 2); // 惰性 + 缓存 + 订阅后推送
const stop = effect(() => console.log(count.value)); // 自动追踪，返回清理函数
batch(() => { a.value = 1; b.value = 2; });     // 合并通知
```

### html 模板

```ts
const frag = html`<p class="x">hi ${name}</p>`;
append(parent, frag);        // 挂载（含 each 视图延迟挂载）
frag.dispose();              // 清理订阅

// 绑定规则：
// ${signal}        → 文本/属性订阅（更新只写目标节点）
// ${value}         → 静态文本
// ${node}          → 子节点插入
// ${each(...)}     → keyed 列表视图
// onclick=${fn}    → 事件（属性赋值优先，自定义事件回退 addEventListener）
// ref=${fn}        → 元素引用回调
// attr=${signal}   → 属性/property（class→className、.checked→checked 等）
```

### each — keyed 列表

```ts
const rows = signal<Row[]>([]);
const list = each(rows, (r) => r.id, (r) => html`<tr>...</tr>`);
append(tbody, html`${list}`);

// 声明式：rows.value = [...] 自动走快路径（追加/清空/全量替换/通用 diff）
// 命令式 O(1)：
list.swap(idA, idB);
list.remove(id);
list.ref(id);   // 行根节点（如做选中高亮）
```

### defineElement — Web Components

```ts
defineElement('re-counter', (el, root) => {
  const count = signal(0);
  root.append(html`<button onclick=${() => count.value++}>${count}</button>`);
  return () => cleanup(); // disconnectedCallback 时执行
}, { shadow: false }); // shadow: true 时 root 为 shadowRoot
```

## 构建

```bash
npm run build   # esbuild → dist/re.js + re.min.js + tsc 声明文件
npm test        # node --test（47 项）
```
