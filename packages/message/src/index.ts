/**
 * @zhenre/message — typed postMessage protocol
 *
 * Wire format (single object, minimal):
 *
 *   { v: 1, ch: <channel name>, id?: <req id>, t: 'pub'|'req'|'res',
 *     topic: string, p?: payload, e?: error }
 *
 *   send/on     fire-and-forget pub/sub
 *   ask/on      request/reply: a handler's return value becomes the reply;
 *               a thrown error becomes `e` and rejects `ask()`
 *
 * Works across Window, Worker and MessagePort. The listening side defaults
 * to: an explicit `listen`, else the target itself for port/worker-like
 * objects, else the current `window` for window-like targets (iframes).
 * Origin allowlist: default `location.origin` when available, else `'*'`.
 * Events with an empty origin (ports) are always accepted.
 */

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

export interface MessageHandler {
  (payload: unknown, event: { origin: string }): unknown;
}

export interface ChannelOptions {
  /** Accepted `event.origin`; default: current origin when known, else '*'. */
  origin?: string;
  /** Channel name — multiple logical channels can share one pipe. */
  name?: string;
  /** Where to listen (defaults: port-like target itself, else window). */
  listen?: {
    addEventListener(type: 'message', fn: (ev: { data?: unknown; origin?: string }) => void): void;
    removeEventListener(type: 'message', fn: (ev: { data?: unknown; origin?: string }) => void): void;
  };
  /** Default timeout for `ask()` in ms (default 10000). */
  timeout?: number;
}

export interface Channel {
  readonly name: string;
  send(topic: string, payload?: unknown): void;
  /** Subscribe; the handler's non-undefined return becomes a reply. */
  on(topic: string, fn: MessageHandler): () => void;
  /** Request/reply; rejects on handler error, close, or timeout. */
  ask<R = unknown>(topic: string, payload?: unknown, timeoutMs?: number): Promise<R>;
  close(): void;
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

interface Envelope {
  v: 1;
  ch: string;
  id?: string;
  t: 'pub' | 'req' | 'res';
  topic: string;
  p?: unknown;
  e?: string;
}

interface Postable {
  postMessage(data: unknown, origin?: string): void;
}

function isWindowLike(t: unknown): boolean {
  return typeof t === 'object' && t !== null && 'location' in t && 'self' in t;
}

function postTo(target: Postable, data: Envelope, origin: string): void {
  if (isWindowLike(target)) target.postMessage(data, origin);
  else target.postMessage(data);
}

function defaultOrigin(): string {
  try {
    return typeof location !== 'undefined' && location.origin !== '' ? location.origin : '*';
  } catch {
    return '*';
  }
}

let msgId = 0;

/* ------------------------------------------------------------------ */
/* channel                                                             */
/* ------------------------------------------------------------------ */

export function createChannel(target: Postable, opts?: ChannelOptions): Channel {
  const name = opts?.name ?? 're';
  const origin = opts?.origin ?? defaultOrigin();
  const listen =
    opts?.listen ??
    ((isWindowLike(target) && typeof window !== 'undefined'
      ? window
      : target) as unknown as NonNullable<ChannelOptions['listen']>);
  const defaultTimeout = opts?.timeout ?? 10_000;

  const handlers = new Map<string, MessageHandler[]>();
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> | null }>();
  let closed = false;

  const deliver = (ev: { data?: unknown; origin?: string }): void => {
    if (closed) return;
    const data = ev.data as Envelope | undefined;
    if (
      typeof data !== 'object' ||
      data === null ||
      (data as Envelope).v !== 1 ||
      (data as Envelope).ch !== name
    ) {
      return;
    }
    // origin allowlist (empty origin = same-process port)
    const evOrigin = ev.origin ?? '';
    if (origin !== '*' && evOrigin !== '' && evOrigin !== origin) return;

    const env = data;
    if (env.t === 'res') {
      const p = env.id !== undefined ? pending.get(env.id) : undefined;
      if (p === undefined) return;
      if (env.id !== undefined) pending.delete(env.id);
      if (p.timer !== null) clearTimeout(p.timer);
      if (env.e !== undefined) p.reject(new Error('[re-message] ' + env.e));
      else p.resolve(env.p);
      return;
    }

    const list = handlers.get(env.topic);
    if (list === undefined || list.length === 0) return;
    for (let i = 0; i < list.length; i++) {
      const fn = list[i]!;
      try {
        const result = fn(env.p, { origin: evOrigin });
        if (env.t !== 'req' || env.id === undefined) continue;
        Promise.resolve(result).then(
          (v) => {
            if (v !== undefined) postTo(target, { v: 1, ch: name, id: env.id, t: 'res', topic: env.topic, p: v }, origin);
          },
          (err: unknown) => {
            postTo(
              target,
              { v: 1, ch: name, id: env.id, t: 'res', topic: env.topic, e: err instanceof Error ? err.message : String(err) },
              origin,
            );
          },
        );
      } catch (err) {
        if (env.t === 'req' && env.id !== undefined) {
          postTo(
            target,
            { v: 1, ch: name, id: env.id, t: 'res', topic: env.topic, e: err instanceof Error ? err.message : String(err) },
            origin,
          );
        }
      }
    }
  };

  listen.addEventListener('message', deliver);

  const ch: Channel = {
    name,
    send(topic: string, payload?: unknown): void {
      if (closed) return;
      postTo(target, { v: 1, ch: name, t: 'pub', topic, p: payload }, origin);
    },
    on(topic: string, fn: MessageHandler): () => void {
      const list = handlers.get(topic) ?? [];
      list.push(fn);
      handlers.set(topic, list);
      return () => {
        const l = handlers.get(topic);
        if (l === undefined) return;
        const i = l.indexOf(fn);
        if (i >= 0) l.splice(i, 1);
        if (l.length === 0) handlers.delete(topic);
      };
    },
    ask<R>(topic: string, payload?: unknown, timeoutMs?: number): Promise<R> {
      if (closed) return Promise.reject(new Error('[re-message] channel closed'));
      return new Promise<R>((resolve, reject) => {
        const id = 'm' + msgId++ + Math.random().toString(36).slice(2, 6);
        const ms = timeoutMs ?? defaultTimeout;
        const timer =
          ms > 0
            ? setTimeout(() => {
                pending.delete(id);
                reject(new Error(`[re-message] timeout (${ms}ms) on "${topic}"`));
              }, ms)
            : null;
        pending.set(id, {
          resolve: resolve as (v: unknown) => void,
          reject,
          timer,
        });
        postTo(target, { v: 1, ch: name, id, t: 'req', topic, p: payload }, origin);
      });
    },
    close(): void {
      if (closed) return;
      closed = true;
      listen.removeEventListener('message', deliver);
      for (const p of pending.values()) {
        if (p.timer !== null) clearTimeout(p.timer);
        p.reject(new Error('[re-message] channel closed'));
      }
      pending.clear();
      handlers.clear();
    },
  };

  return ch;
}
