import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.ts';
setupDom();

const { defineElement, html, signal, append } = await import('../src/index.ts');

test('defineElement: light DOM custom element mounts content', async () => {
  const tag = 're-test-a';
  defineElement(tag, (el) => {
    const count = signal(0);
    el.append(
      html`<button onclick=${() => count.value++}>count: ${count}</button>`,
    );
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ce = document.createElement(tag);
  host.appendChild(ce);
  // happy-dom upgrades synchronously on append
  const btn = ce.querySelector('button') as HTMLElement;
  assert.ok(btn, 'content mounted');
  btn.click();
  assert.equal(btn.textContent!.includes('1'), true);
  document.body.innerHTML = '';
});

test('defineElement: cleanup fn runs on disconnect', async () => {
  const tag = 're-test-b';
  let cleaned = 0;
  defineElement(tag, () => {
    return () => {
      cleaned++;
    };
  });
  const ce = document.createElement(tag);
  document.body.appendChild(ce);
  ce.remove();
  assert.equal(cleaned, 1);
});

test('defineElement: shadow option renders into shadow root', async () => {
  const tag = 're-test-c';
  defineElement(
    tag,
    (el, root) => {
      root.append(html`<b>shadowed</b>`);
    },
    { shadow: true },
  );
  const ce = document.createElement(tag) as HTMLElement & { shadowRoot: ShadowRoot | null };
  document.body.appendChild(ce);
  assert.ok(ce.shadowRoot, 'shadow root attached');
  assert.ok(ce.shadowRoot!.querySelector('b'), 'content in shadow');
  assert.equal(ce.textContent, '');
  document.body.innerHTML = '';
});

test('defineElement: idempotent redefinition', async () => {
  const tag = 're-test-d';
  defineElement(tag, () => {});
  defineElement(tag, () => {}); // must not throw
  const ce = document.createElement(tag);
  append(document.body, ce);
  assert.ok(ce);
  document.body.innerHTML = '';
});
