import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.ts';
setupDom();

const { html, append, each, signal } = await import('../src/index.ts');

function el(tag: string): HTMLElement {
  return document.createElement(tag);
}

test('html: static content, no slots', () => {
  const frag = html`<div id="a"><span>hi</span></div>`;
  const div = frag.root as HTMLElement;
  assert.equal(div.id, 'a');
  assert.equal(div.querySelector('span')!.textContent, 'hi');
});

test('html: plain text binding', () => {
  const frag = html`<p>Hello ${'world'} and ${42}</p>`;
  assert.equal((frag.root as HTMLElement).textContent, 'Hello world and 42');
});

test('html: signal text binding updates in place', () => {
  const name = signal('ada');
  const frag = html`<p>hi ${name}</p>`;
  const p = frag.root as HTMLElement;
  const textNode = p.childNodes[1] as Text;
  assert.equal(p.textContent, 'hi ada');
  name.value = 'grace';
  assert.equal(textNode.data, 'grace');
  frag.dispose();
});

test('html: null/undefined render as empty string', () => {
  const frag = html`<p>${null}-${undefined}-${''}</p>`;
  assert.equal((frag.root as HTMLElement).textContent, '--');
});

test('html: function as text binding (getter)', () => {
  const s = signal(1);
  const frag = html`<p>${() => s.value * 2}</p>`;
  const p = frag.root as HTMLElement;
  assert.equal(p.textContent, '2');
  s.value = 5;
  assert.equal(p.textContent, '10');
  frag.dispose();
});

test('html: class attr binding', () => {
  const cls = signal('a b');
  const frag = html`<div class=${cls}></div>`;
  const d = frag.root as HTMLElement;
  assert.equal(d.className, 'a b');
  cls.value = 'c';
  assert.equal(d.className, 'c');
  frag.dispose();
});

test('html: onclick event via property', () => {
  let clicked = 0;
  const frag = html`<button onclick=${() => clicked++}>go</button>`;
  const b = frag.root as HTMLElement;
  b.click();
  assert.equal(clicked, 1);
});

test('html: custom event falls back to addEventListener', () => {
  let n = 0;
  const frag = html`<button onmyevent=${() => n++}>go</button>`;
  const b = frag.root as HTMLElement;
  b.dispatchEvent(new Event('myevent'));
  assert.equal(n, 1);
});

test('html: ref callback', () => {
  let ref: unknown = null;
  const frag = html`<div ref=${(e: Element) => { ref = e; }}></div>`;
  assert.equal(ref, frag.root);
});

test('html: interpolated attr with signal', () => {
  const x = signal('1');
  const frag = html`<div data-x="pre-${x}-post"></div>`;
  const d = frag.root as HTMLElement;
  assert.equal(d.getAttribute('data-x'), 'pre-1-post');
  x.value = '2';
  assert.equal(d.getAttribute('data-x'), 'pre-2-post');
  frag.dispose();
});

test('html: node binding inserts a node', () => {
  const child = el('b');
  child.textContent = 'bold';
  const frag = html`<div>a${child}c</div>`;
  assert.equal((frag.root as HTMLElement).textContent, 'aboldc');
});

test('html: nested html fragment merges disposers + mounts', () => {
  const s = signal('x');
  const inner = html`<em>${s}</em>`;
  const outer = html`<div>${inner}</div>`;
  append(document.body, outer);
  const em = document.querySelector('em')!;
  assert.equal(em.textContent, 'x');
  s.value = 'y';
  assert.equal(em.textContent, 'y');
  outer.dispose();
  // subscription removed — no leak semantics checked here, just no-throw
  s.value = 'z';
  document.body.innerHTML = '';
});

test('html: template identity cache — two instances are independent', () => {
  const a = html`<div>${'one'}</div>`;
  const b = html`<div>${'two'}</div>`;
  assert.equal((a.root as HTMLElement).textContent, 'one');
  assert.equal((b.root as HTMLElement).textContent, 'two');
  assert.notEqual(a.root, b.root);
});

test('append: runs deferred each() mounts after insertion', () => {
  const rows = signal([{ id: 1 }, { id: 2 }]);
  const list = each(rows, (r) => r.id, (r) => html`<i>row ${r.id}</i>`);
  const host = el('div');
  append(host, html`<div>${list}</div>`);
  assert.equal(host.querySelectorAll('i').length, 2);
  rows.value = [{ id: 3 }];
  assert.equal(host.querySelectorAll('i').length, 1);
  assert.equal(host.querySelector('i')!.textContent, 'row 3');
});

test('html: precompiled registry honored (registerTemplates)', async () => {
  const { registerTemplates } = await import('../src/template.ts');
  const strings = ['<q>', '</q>'];
  const key = strings.join('\u0000');
  registerTemplates(key, [{ k: 0, i: 0, p: [0, 0] }]);
  const frag = html(strings as unknown as TemplateStringsArray, 'slotted');
  assert.equal((frag.root as HTMLElement).textContent, 'slotted');
});
