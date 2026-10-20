/** Embedded project templates for create-re. */

export interface TemplateFile {
  path: string;
  content: string;
}

export interface Template {
  description: string;
  files: TemplateFile[];
}

const baseTsconfig = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
`;

const baseViteConfig = `import { defineConfig } from 'vite';
import re from '@re/vite-plugin';

export default defineConfig({
  plugins: [re()],
});
`;

const baseGitignore = `node_modules/
dist/
.DS_Store
`;

function pkgJson(name: string): string {
  return `{
  "name": "${name}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@re/core": "^0.1.0",
    "@re/vite-plugin": "^0.1.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^6.0.0"
  }
}
`;
}

function indexHtml(title: string, main = '/src/main.ts'): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="${main}"></script>
  </body>
</html>
`;
}

const readme = (title: string, body: string): string => `# ${title}

${body}

## 开发

\`\`\`bash
npm install
npm run dev      # http://localhost:5173
npm run build
\`\`\`

技术栈：[@re/core](https://github.com/) — 细粒度信号 + 原生 HTML 模板 + Web Components，零依赖零 VDOM。
`;

const minimalMain = `import { html, append, signal, defineElement } from '@re/core';

// ── 原生 Web Component：组件就是自定义元素 ──────────────────────────
defineElement('re-counter', (el, root) => {
  const count = signal(0);
  root.append(html\`
    <button onclick=\${() => count.value++}>
      点击次数：\${count}
    </button>
  \`);
  return () => console.log('counter removed'); // 断开连接时清理
});

// ── 页面：真实 HTML 模板，无 VDOM ────────────────────────────────
const app = html\`
  <main style="font-family: system-ui; max-width: 32rem; margin: 4rem auto">
    <h1>⚡ @re minimal</h1>
    <p>组件是原生自定义元素，模板是真实 HTML，状态是细粒度信号。</p>
    <re-counter></re-counter>
  </main>
\`;

append(document.getElementById('app')!, app);
`;

const demoMain = `import { html, append, signal, computed, each, defineElement } from '@re/core';

interface Todo {
  id: number;
  text: string;
  done: ReturnType<typeof signal<boolean>>;
}

let nextId = 1;
const todos = signal<Todo[]>([
  { id: nextId++, text: '了解 @re 的细粒度信号', done: signal(false) },
  { id: nextId++, text: '试试添加/删除待办', done: signal(true) },
]);
const draft = signal('');
const remaining = computed(() => todos.value.filter((t) => !t.done.value).length);

const list = each(todos, (t) => t.id, (t) => html\`
  <li class=\${() => (t.done.value ? 'todo done' : 'todo')}>
    <label>
      <input type="checkbox" .checked=\${t.done} onchange=\${() => (t.done.value = !t.done.peek())} />
      <span>\${t.text}</span>
    </label>
    <button class="del" onclick=\${() => remove(t.id)}>×</button>
  </li>
\`);

function remove(id: number): void {
  todos.value = todos.peek().filter((t) => t.id !== id);
}

function add(e: Event): void {
  e.preventDefault();
  const text = draft.peek().trim();
  if (text === '') return;
  todos.value = todos.peek().concat({ id: nextId++, text, done: signal(false) });
  draft.value = '';
}

defineElement('todo-app', (_el, root) => {
  root.append(html\`
    <main class="wrap">
      <h1>⚡ @re todos</h1>
      <form onsubmit=\${add}>
        <input
          placeholder="想做点什么？回车添加"
          .value=\${draft}
          oninput=\${(e: Event) => (draft.value = (e.target as HTMLInputElement).value)}
        />
        <button type="submit">添加</button>
      </form>
      <ul class="list">\${list}</ul>
      <footer>剩 \${remaining} 项未完成 · 共 \${() => todos.peek().length} 项</footer>
    </main>
  \`);
});

append(document.getElementById('app')!, html\`<todo-app></todo-app>\`);

document.head.append(html\`
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; background: #0f1115; color: #e6e8ee; }
    .wrap { max-width: 34rem; margin: 4rem auto; padding: 0 1rem; }
    h1 { letter-spacing: -0.02em; }
    form { display: flex; gap: 0.5rem; }
    input[type='text'], input:not([type]) {
      flex: 1; padding: 0.6rem 0.8rem; border-radius: 8px;
      border: 1px solid #2a2f3a; background: #161a22; color: inherit;
    }
    button { padding: 0.6rem 1rem; border: 0; border-radius: 8px; background: #4f6ef7; color: white; cursor: pointer; }
    button.del { background: transparent; color: #8b93a7; font-size: 1.1rem; }
    .list { list-style: none; padding: 0; }
    .todo { display: flex; justify-content: space-between; align-items: center; padding: 0.55rem 0.2rem; border-bottom: 1px solid #222836; }
    .todo.done span { text-decoration: line-through; color: #6b7280; }
    footer { color: #8b93a7; font-size: 0.9rem; margin-top: 1rem; }
  </style>
\`);
`;

const demoReadmeExtra = `\n包含：信号、computed、keyed 列表（each）、事件绑定、Web Components。\n`;

const benchMain = `import { html, append, signal, each } from '@re/core';

/**
 * js-framework-benchmark 风格的 keyed 表格：
 * - 每行一个信号（细粒度：部分更新只触碰目标文本节点）
 * - each 返回锚点式 keyed 视图，提供 O(1) 的 swap / remove / ref
 */
interface Row {
  id: number;
  label: ReturnType<typeof signal<string>>;
}

let idSeq = 1;
const rand = (max: number) => Math.round(Math.random() * 1000) % max;
const ADJ = ['pretty', 'large', 'big', 'small', 'tall', 'short'];
const COL = ['red', 'yellow', 'blue', 'green', 'pink', 'brown'];
const NOUN = ['table', 'chair', 'house', 'car', 'pony', 'cookie'];

function buildData(count: number): Row[] {
  return Array.from({ length: count }, () => ({
    id: idSeq++,
    label: signal(ADJ[rand(ADJ.length)] + ' ' + COL[rand(COL.length)] + ' ' + NOUN[rand(NOUN.length)]),
  }));
}

const rows = signal<Row[]>([]);
const list = each(rows, (r) => r.id, (r) => {
  const f = html\`<tr><td class="col-md-1">\${r.id}</td><td class="col-md-4"><a>\${r.label}</a></td><td class="col-md-1"><a class="del"><span aria-hidden="true">×</span></a></td><td class="col-md-6"></td></tr>\`;
  (f.root as HTMLElement).dataset.id = String(r.id);
  return f;
});

let selected: HTMLElement | null = null;

const actions = {
  run: () => { selected = null; rows.value = buildData(1000); },
  runlots: () => { selected = null; rows.value = buildData(10000); },
  add: () => { rows.value = rows.peek().concat(buildData(1000)); },
  update: () => {
    for (const r of rows.peek()) if (r.id % 10 === 0) r.label.value = r.label.peek() + ' !!!';
  },
  clear: () => { selected = null; rows.value = []; },
  swaprows: () => {
    const arr = rows.peek();
    if (arr.length > 10) list.swap(arr[1]!.id, arr[arr.length - 2]!.id);
  },
};

const tbody = document.getElementById('tbody')!;
append(tbody, html\`\${list}\`);

tbody.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const del = target.closest('.del');
  if (del !== null) {
    const tr = del.closest('tr')!;
    if (tr === selected) selected = null;
    list.remove(Number((tr as HTMLElement).dataset.id));
    return;
  }
  const tr = target.closest('tr') as HTMLElement | null;
  if (tr === null) return;
  if (selected !== null) selected.className = '';
  tr.className = 'danger';
  selected = tr;
});

for (const [id, fn] of Object.entries(actions)) {
  document.getElementById(id)!.addEventListener('click', fn);
}
`;

const benchIndexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>@re keyed table</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1d23; }
      .btns { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
      button { padding: 0.5rem 0.9rem; border: 1px solid #c9ced8; border-radius: 6px; background: #4f6ef7; border-color: #4f6ef7; color: white; cursor: pointer; }
      table { border-collapse: collapse; width: 100%; max-width: 56rem; }
      td { padding: 0.35rem 0.6rem; border-bottom: 1px solid #eceef2; }
      tr.danger td { background: #fde8e8; }
      tr:hover td { background: #f4f6fa; }
      .del { cursor: pointer; color: #c0392b; }
    </style>
  </head>
  <body>
    <h1>⚡ @re — keyed table demo</h1>
    <div class="btns">
      <button id="run">创建 1,000 行</button>
      <button id="runlots">创建 10,000 行</button>
      <button id="add">追加 1,000 行</button>
      <button id="update">每 10 行更新</button>
      <button id="swaprows">交换行</button>
      <button id="clear">清空</button>
    </div>
    <table>
      <tbody id="tbody"></tbody>
    </table>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

export const TEMPLATES: Record<string, Template> = {
  minimal: {
    description: '计数器 + Web Component，10 秒上手',
    files: [
      { path: 'package.json', content: pkgJson('my-re-app') },
      { path: 'vite.config.ts', content: baseViteConfig },
      { path: 'tsconfig.json', content: baseTsconfig },
      { path: 'index.html', content: indexHtml('@re minimal') },
      { path: 'src/main.ts', content: minimalMain },
      {
        path: 'README.md',
        content: readme('@re minimal', '最小 @re 应用：信号 + 原生 Web Components。'),
      },
      { path: '.gitignore', content: baseGitignore },
    ],
  },
  demo: {
    description: '待办应用：signals / computed / each / 事件 / 样式',
    files: [
      { path: 'package.json', content: pkgJson('my-re-app') },
      { path: 'vite.config.ts', content: baseViteConfig },
      { path: 'tsconfig.json', content: baseTsconfig },
      { path: 'index.html', content: indexHtml('@re todos') },
      { path: 'src/main.ts', content: demoMain },
      {
        path: 'README.md',
        content: readme('@re todos', '一个 @re 待办应用。' + demoReadmeExtra),
      },
      { path: '.gitignore', content: baseGitignore },
    ],
  },
  bench: {
    description: 'keyed 大表格（js-framework-benchmark 同款操作）',
    files: [
      { path: 'package.json', content: pkgJson('my-re-app') },
      { path: 'vite.config.ts', content: baseViteConfig },
      { path: 'tsconfig.json', content: baseTsconfig },
      { path: 'index.html', content: benchIndexHtml },
      { path: 'src/main.ts', content: benchMain },
      {
        path: 'README.md',
        content: readme(
          '@re keyed table',
          'js-framework-benchmark 同款的 keyed 表格演示：创建/追加/部分更新/选中/交换/删除/清空。',
        ),
      },
      { path: '.gitignore', content: baseGitignore },
    ],
  },
};
