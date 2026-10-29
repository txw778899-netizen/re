/**
 * @zhenre/vite-plugin smoke test: transforms a source snippet, evaluates it in a
 * real DOM, and asserts behavior is identical to the untransformed path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupCoreDom } from './core-helpers/dom.ts';

// DOM must exist before @zhenre/core evaluates (ReFragment extends DocumentFragment).
setupCoreDom();
const plugin = (await import('../src/index.ts')).default;
const core = await import('../../core/src/index.ts');

test('plugin transforms html`` into precompiled wires (code-level)', () => {
  const p = plugin();
  const code = [
    "import { html, signal } from '@zhenre/core';",
    "const cls = signal('a');",
    "const name = signal('b');",
    'const t = html`<p class=${cls}>hi ${name}</p>`;',
  ].join('\n');
  const out = p.transform(code, '/src/app.ts');
  assert.ok(out, 'transform applied');
  assert.match(out.code, /__re_wire_0 = __re_wire\(/);
  assert.match(out.code, /"k":0/); // text slot
  assert.match(out.code, /"k":1/); // attr slot
  assert.equal(out.code.includes('html`'), false, 'runtime html call removed');
});

test('plugin leaves non-matching files untouched', () => {
  const p = plugin();
  assert.equal(p.transform('const a = 1;', '/src/plain.ts'), null);
  assert.equal(
    p.transform("const t = html`<b>x</b>`;", '/node_modules/x/index.js'),
    null,
  );
});

test('transformed template behaves identically in a real DOM', async () => {
  setupCoreDom();
  const p = plugin();
  const code = [
    "import { html, signal } from '@zhenre/core';",
    "const name = signal('ada');",
    'const make = () => html`<p class="who">hi ${name}</p>`;',
    'export { make, name };',
  ].join('\n');
  const out = p.transform(code, '/src/app.ts');
  assert.ok(out);

  // evaluate transformed module body inside this DOM context
  const body = out.code
    .replace("import { __wireTemplate as __re_wire } from '@zhenre/core';", '')
    .replace("import { html, signal } from '@zhenre/core';", '')
    .replace(/export\s*\{[^}]*\};?/g, '');
  const mod = new Function(
    '__re_wire, html, signal',
    body + '\nreturn { make, name };',
  )(core.__wireTemplate, core.html, core.signal);

  const frag = mod.make();
  document.body.appendChild(frag);
  const pEl = document.querySelector('p.who')!;
  assert.equal(pEl.textContent, 'hi ada');
  mod.name.value = 'grace';
  assert.equal(pEl.textContent, 'hi grace');
  document.body.innerHTML = '';
});
