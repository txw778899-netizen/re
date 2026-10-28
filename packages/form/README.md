# @zhenre/form

Signal-based forms: two-way binding, touched/dirty protocol, sync+async validation. Zero dependencies (peer: `@zhenre/core`).

```ts
import { createForm } from '@zhenre/form';
import { html } from '@zhenre/core';

const form = createForm(rootEl, {
  validators: {
    email: [(v) => (String(v).includes('@') ? null : 'invalid email')],
    nick: async (v) => ((await checkAvailable(String(v))) ? null : 'taken'),
  },
  onSubmit: (values) => save(values),
});

// fields ARE signals — bind straight into templates
html`<input name="email" class=${() => form.fields.email.error.value ? 'err' : ''}>`;

form.fields.email.touched.value; // validated after first blur (touched protocol)
form.valid.value;                // computed, reactive
form.dirty.value;                // any field differs from initial
await form.submit();             // validates all → onSubmit(values) → returns values | null
form.reset();
```

- Input mapping: `checkbox` → boolean, `number` → number, radio groups collapse to one field, rest are strings.
- Validation: after first blur, then on every input; async validators are race-safe (last input wins); `submit()` validates everything and is idempotent-safe.
- `bind(el, signal)` is exported for standalone two-way binding outside forms.
