import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.ts';
setupDom();

const win = (globalThis as unknown as { window: import('happy-dom').Window }).window;
const { signal } = await import('@zhenre/core');
const { bind, createForm } = await import('../src/index.ts');

const fireInput = (el: Element): void => {
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
};
const fireFocusOut = (el: Element): void => {
  el.dispatchEvent(new win.Event('focusout', { bubbles: true }));
};
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function makeForm(html: string): HTMLFormElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const form = tpl.content.querySelector('form')!;
  document.body.append(form);
  return form;
}

test('bind: two-way text input', () => {
  const s = signal('a');
  const input = document.createElement('input');
  document.body.append(input);
  const unbind = bind(input, s);
  assert.equal(input.value, 'a');
  input.value = 'hello';
  fireInput(input);
  assert.equal(s.value, 'hello');
  s.value = 'reactive';
  assert.equal(input.value, 'reactive');
  unbind();
  input.remove();
});

test('bind: checkbox → boolean, number → number', () => {
  const cb = signal(false);
  const el1 = document.createElement('input') as HTMLInputElement;
  el1.type = 'checkbox';
  document.body.append(el1);
  const u1 = bind(el1, cb);
  el1.checked = true;
  fireInput(el1);
  assert.equal(cb.value, true);
  u1();

  const n = signal(1);
  const el2 = document.createElement('input') as HTMLInputElement;
  el2.type = 'number';
  document.body.append(el2);
  const u2 = bind(el2, n);
  el2.value = '42';
  fireInput(el2);
  assert.equal(n.value, 42);
  u2();
  el1.remove();
  el2.remove();
});

test('form: fields discovered, values snapshot, dirty tracking', () => {
  const form = makeForm(`<form>
    <input name="user" value="ada">
    <input name="age" type="number" value="36">
    <input name="ok" type="checkbox" checked>
  </form>`);
  const f = createForm(form);
  assert.deepEqual(f.values(), { user: 'ada', age: 36, ok: true });
  assert.equal(f.dirty.value, false);
  (form.querySelector('input[name=user]') as HTMLInputElement).value = 'grace';
  fireInput(form.querySelector('input[name=user]') as HTMLInputElement);
  assert.equal(f.dirty.value, true);
  f.reset();
  assert.equal(f.dirty.value, false);
  assert.equal(f.values().user, 'ada');
  f.destroy();
});

test('form: touched protocol — validate on blur, error clears on fix', async () => {
  const form = makeForm(`<form><input name="email" value=""></form>`);
  const f = createForm(form, {
    validators: { email: (v) => String(v).includes('@') ? null : 'invalid email' },
  });
  const input = form.querySelector('input') as HTMLInputElement;
  assert.equal(f.fields.email!.error.value, null); // untouched → no error yet
  input.value = 'not-an-email';
  fireInput(input);
  fireFocusOut(input);
  await tick();
  assert.equal(f.fields.email!.touched.value, true);
  assert.equal(f.fields.email!.error.value, 'invalid email');
  assert.equal(f.valid.value, false);
  input.value = 'a@b.c';
  fireInput(input);
  await tick();
  assert.equal(f.fields.email!.error.value, null);
  assert.equal(f.valid.value, true);
  f.destroy();
});

test('form: async validators race-safe (last input wins)', async () => {
  const form = makeForm(`<form><input name="nick" value=""></form>`);
  let calls = 0;
  const f = createForm(form, {
    validators: {
      nick: async (v) => {
        calls++;
        await new Promise((r) => setTimeout(r, 20)); // slow check
        return v === 'free' ? null : 'taken';
      },
    },
  });
  const input = form.querySelector('input') as HTMLInputElement;
  input.value = 'busy';
  fireInput(input);
  fireFocusOut(input);
  // user keeps typing while the slow validator is in flight
  input.value = 'free';
  fireInput(input);
  await tick(60);
  assert.equal(f.fields.nick!.error.value, null);
  f.destroy();
});

test('form: submit validates all, blocks invalid, calls onSubmit with values', async () => {
  const form = makeForm(`<form>
    <input name="a" value="">
    <input name="b" value="ok">
  </form>`);
  let submitted: Record<string, unknown> | null = null;
  const f = createForm(form, {
    validators: { a: (v) => (v === '' ? 'required' : null) },
    onSubmit: async (values) => {
      submitted = values;
    },
  });
  const res1 = await f.submit();
  assert.equal(res1, null); // invalid
  assert.equal(submitted, null);
  assert.equal(f.fields.a!.error.value, 'required');

  (form.querySelector('input[name=a]') as HTMLInputElement).value = 'x';
  fireInput(form.querySelector('input[name=a]') as HTMLInputElement);
  const res2 = await f.submit();
  assert.deepEqual(res2, { a: 'x', b: 'ok' });
  assert.deepEqual(submitted, { a: 'x', b: 'ok' });
  f.destroy();
});

test('form: native submit event prevented and routed through pipeline', async () => {
  const form = makeForm(`<form><input name="a" value="v"></form>`);
  let submitted = false;
  const f = createForm(form, { onSubmit: () => { submitted = true; } });
  const ev = new win.Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(ev);
  await tick();
  assert.equal(ev.defaultPrevented, true);
  assert.equal(submitted, true);
  f.destroy();
});

test('form: radio group collapses to one field', () => {
  const form = makeForm(`<form>
    <input type="radio" name="color" value="r">
    <input type="radio" name="color" value="g" checked>
    <input type="radio" name="color" value="b">
  </form>`);
  const f = createForm(form);
  assert.equal(Object.keys(f.fields).length, 1);
  assert.equal(f.values().color, 'g');
  const radios = form.querySelectorAll<HTMLInputElement>('input[name=color]');
  radios[2]!.checked = true;
  fireInput(radios[2]!);
  assert.equal(f.values().color, 'b');
  f.destroy();
});
