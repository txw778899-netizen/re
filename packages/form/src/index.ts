/**
 * @zhenre/form — signals in, signals out
 *
 * Every named input/select/textarea in the form becomes a reactive field:
 * two-way bound to a signal, validated after first blur (touched protocol)
 * and on submit. No wrappers, no render props — fields ARE signals, so
 * `html`` templates bind to them directly.
 *
 * ```ts
 * const form = createForm(rootEl, {
 *   validators: {
 *     email: [(v) => String(v).includes('@') ? null : 'invalid email'],
 *     nick: async (v) => (await check(v)) ? null : 'taken',
 *   },
 *   onSubmit: async (values) => save(values),
 * });
 * // form.fields.email.value.value / .error.value / .touched.value
 * // form.valid.value / form.dirty.value / form.submit()
 * ```
 *
 * Input mapping: `type=checkbox` → boolean (checked), `type=number` → number,
 * radio groups collapse to one field per name (the checked value), everything
 * else is a string.
 */

import { computed, signal, isSignal, untrack } from '@zhenre/core';
import type { Computed, Signal } from '@zhenre/core';

/* ------------------------------------------------------------------ */
/* bind                                                                */
/* ------------------------------------------------------------------ */

export type Bindable = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * Two-way bind a control to a signal. Returns an unbind function.
 * Reading is live (`input` events); writing updates the control directly.
 */
export function bind(
  el: Bindable,
  sig: Signal<unknown> | Computed<unknown>,
  event: 'input' | 'change' = 'input',
): () => void {
  const isCheck = (el as HTMLInputElement).type === 'checkbox';
  const isNum = (el as HTMLInputElement).type === 'number';

  const write = (v: unknown): void => {
    if (isCheck) (el as HTMLInputElement).checked = Boolean(v);
    else (el as HTMLInputElement).value = v === null || v === undefined ? '' : String(v);
  };

  const sub = {
    run(v: unknown): void {
      write(v);
    },
  };

  const read = (): unknown => {
    if (isCheck) return (el as HTMLInputElement).checked;
    const raw = (el as HTMLInputElement).value;
    return isNum && raw !== '' ? Number(raw) : raw;
  };

  const onInput = (): void => {
    if (isSignal(sig)) (sig as Signal<unknown>).value = read();
  };

  write(untrack(() => sig.value));
  el.addEventListener(event, onInput);
  if (isSignal(sig)) sig.$sub(sub);

  return () => {
    el.removeEventListener(event, onInput);
    if (isSignal(sig)) sig.$unsub(sub);
  };
}

/* ------------------------------------------------------------------ */
/* form                                                                */
/* ------------------------------------------------------------------ */

export type Validator = (
  value: unknown,
  values: Record<string, unknown>,
) => string | null | Promise<string | null>;

export interface FieldState {
  readonly name: string;
  value: Signal<unknown>;
  error: Signal<string | null>;
  touched: Signal<boolean>;
}

export interface FormOptions {
  validators?: Record<string, Validator | Validator[]>;
  onSubmit?: (values: Record<string, unknown>) => unknown | Promise<unknown>;
}

export interface FormState {
  readonly fields: Record<string, FieldState>;
  readonly valid: Computed<boolean>;
  readonly dirty: Computed<boolean>;
  values(): Record<string, unknown>;
  /** Validate everything; on success calls onSubmit and returns the values. */
  submit(): Promise<Record<string, unknown> | null>;
  reset(): void;
  destroy(): void;
}

function inputRead(el: Bindable): unknown {
  if ((el as HTMLInputElement).type === 'checkbox') return (el as HTMLInputElement).checked;
  if ((el as HTMLInputElement).type === 'radio') {
    return (el as HTMLInputElement).checked ? (el as HTMLInputElement).value : '';
  }
  const raw = (el as HTMLInputElement).value;
  return (el as HTMLInputElement).type === 'number' && raw !== '' ? Number(raw) : raw;
}

export function createForm(root: HTMLFormElement, opts?: FormOptions): FormState {
  const validators = opts?.validators ?? {};
  const fields: Record<string, FieldState> = {};
  const order: string[] = [];
  const initial: unknown[] = [];
  const unbinds: (() => void)[] = [];
  const validateTokens = new Map<string, number>();

  // radio groups: one field per name, first control binds, all update
  const seenRadio = new Set<string>();

  const controls = root.querySelectorAll<Bindable>('input[name], select[name], textarea[name]');
  for (let i = 0; i < controls.length; i++) {
    const el = controls[i]!;
    const name = el.name;
    if (name === '') continue;
    let field = fields[name];
    if (field === undefined) {
      field = fields[name] = {
        name,
        value: signal<unknown>(inputRead(el)),
        error: signal<string | null>(null),
        touched: signal(false),
      };
      order.push(name);
      initial.push(field.value.peek());
    } else if ((el as HTMLInputElement).type === 'radio') {
      // keep group semantics: field value tracks whichever radio is checked
      if ((el as HTMLInputElement).checked) field.value.value = (el as HTMLInputElement).value;
    }
    if ((el as HTMLInputElement).type === 'radio') {
      if (seenRadio.has(name)) continue;
      seenRadio.add(name);
      const group = root.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${name}"]`);
      const onRadio = (ev: Event): void => {
        const t = ev.target as HTMLInputElement;
        if (t.checked) field!.value.value = t.value;
      };
      for (let r = 0; r < group.length; r++) {
        group[r]!.addEventListener('input', onRadio);
        unbinds.push(() => group[r]!.removeEventListener('input', onRadio));
      }
      continue;
    }
    unbinds.push(bind(el, field.value));
  }

  function snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < order.length; i++) out[order[i]!] = fields[order[i]!]!.value.peek();
    return out;
  }

  async function validate(name: string): Promise<boolean> {
    const rules = validators[name];
    const field = fields[name]!;
    if (rules === undefined) {
      field.error.value = null;
      return true;
    }
    const list = Array.isArray(rules) ? rules : [rules];
    const token = (validateTokens.get(name) ?? 0) + 1;
    validateTokens.set(name, token);
    const vals = snapshot();
    for (let i = 0; i < list.length; i++) {
      const msg = await list[i]!(field.value.peek(), vals);
      if (token !== validateTokens.get(name)) return false; // stale — newer input won
      if (msg !== null && msg !== undefined && msg !== '') {
        field.error.value = msg;
        return false;
      }
    }
    field.error.value = null;
    return true;
  }

  function onInput(ev: Event): void {
    const el = ev.target as Bindable | null;
    if (el === null || el.name === '') return;
    const f = fields[el.name];
    if (f !== undefined && f.touched.peek()) void validate(el.name);
  }

  function onFocusOut(ev: Event): void {
    const el = ev.target as Bindable | null;
    if (el === null || el.name === '') return;
    const f = fields[el.name];
    if (f === undefined || f.touched.peek()) return;
    f.touched.value = true;
    void validate(el.name);
  }

  function onNativeSubmit(ev: Event): void {
    ev.preventDefault();
    void submit();
  }

  root.addEventListener('input', onInput);
  root.addEventListener('focusout', onFocusOut);
  root.addEventListener('submit', onNativeSubmit);

  const valid = computed(() => {
    for (let i = 0; i < order.length; i++) {
      if (fields[order[i]!]!.error.value !== null) return false;
    }
    return true;
  });

  const dirty = computed(() => {
    for (let i = 0; i < order.length; i++) {
      const v = fields[order[i]!]!.value.value;
      const init = initial[i];
      if (v !== init) return true;
    }
    return false;
  });

  async function submit(): Promise<Record<string, unknown> | null> {
    const checks = order.map((n) => {
      fields[n]!.touched.value = true;
      return validate(n);
    });
    await Promise.all(checks);
    if (!untrack(() => valid.value)) return null;
    const vals = snapshot();
    await opts?.onSubmit?.(vals);
    return vals;
  }

  return {
    fields,
    valid,
    dirty,
    values: snapshot,
    submit,
    reset(): void {
      for (let i = 0; i < order.length; i++) {
        const f = fields[order[i]!]!;
        f.value.value = initial[i];
        f.error.value = null;
        f.touched.value = false;
      }
    },
    destroy(): void {
      root.removeEventListener('input', onInput);
      root.removeEventListener('focusout', onFocusOut);
      root.removeEventListener('submit', onNativeSubmit);
      for (let i = 0; i < unbinds.length; i++) unbinds[i]!();
      unbinds.length = 0;
      validateTokens.clear();
    },
  };
}
