# @zhenre/message

Typed `postMessage` protocol: pub/sub + request/reply, origin-allowlisted. Works across `Window` (iframes/popups), `Worker` and `MessagePort`. Zero dependencies.

```ts
import { createChannel } from '@zhenre/message';

// main page → iframe
const ch = createChannel(iframe.contentWindow);

// worker side (listens on itself by default)
const workerCh = createChannel(self);

ch.send('theme', { dark: true });
const off = ch.on('ping', () => 'pong');     // return value = reply
const pong = await other.ask<string>('ping'); // request/reply with id + timeout
ch.close();
```

Wire format: `{ v: 1, ch, id?, t: 'pub'|'req'|'res', topic, p?, e? }`

- Channel names isolate traffic on the same pipe.
- `ask()` rejects on handler error (message preserved), close, or timeout (default 10s, per-call overridable).
- Origin allowlist defaults to the current origin (ports with empty origin always pass); override with `{ origin: 'https://trusted.example' }` or `'*'`.
