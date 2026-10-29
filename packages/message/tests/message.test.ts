import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Two cross-wired pipe stubs: whatever one "posts", the other "dispatches"
 * as a message event — deterministic, no real Worker/Window involved.
 */
type Ev = { data?: unknown; origin?: string };

function makePeer(origin: string) {
  const listeners: ((ev: Ev) => void)[] = [];
  const peer = {
    sent: [] as unknown[],
    listeners,
    addEventListener(type: string, fn: (ev: Ev) => void): void {
      if (type === 'message') listeners.push(fn);
    },
    removeEventListener(type: string, fn: (ev: Ev) => void): void {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    postMessage(data: unknown, _o?: string): void {
      peer.sent.push(data);
      peer.remote?.(data);
    },
    dispatch(data: unknown, o = origin): void {
      for (const fn of [...listeners]) fn({ data, origin: o });
    },
    remote: null as ((data: unknown) => void) | null,
  };
  return peer;
}

const A = makePeer('https://a.test');
const B = makePeer('https://b.test');
A.remote = (data) => B.dispatch(data, 'https://a.test');
B.remote = (data) => A.dispatch(data, 'https://b.test');

const { createChannel } = await import('../src/index.ts');
const chA = createChannel(A as never, { origin: '*', name: 't', listen: A as never });
const chB = createChannel(B as never, { origin: '*', name: 't', listen: B as never });

test('pub/sub: send delivers payload; unsubscribe stops delivery', () => {
  const got: unknown[] = [];
  const off = chB.on('greet', (p) => {
    got.push(p);
  });
  chA.send('greet', { msg: 'hi' });
  assert.deepEqual(got, [{ msg: 'hi' }]);
  off();
  chA.send('greet', 2);
  assert.deepEqual(got, [{ msg: 'hi' }]);
});

test('req/rep: handler return becomes the reply (sync + async)', async () => {
  chB.on('double', (p) => (p as number) * 2);
  chB.on('slow', async (p) => {
    await new Promise((r) => setTimeout(r, 10));
    return `ok:${String(p)}`;
  });
  assert.equal(await chA.ask<number>('double', 21), 42);
  assert.equal(await chA.ask<string>('slow', 'x'), 'ok:x');
});

test('req/rep: handler error rejects ask with the message', async () => {
  chB.on('boom', () => {
    throw new Error('kaputt');
  });
  chB.on('boomAsync', async () => {
    throw new Error('kaputt-async');
  });
  await assert.rejects(chA.ask('boom', null), /kaputt/);
  await assert.rejects(chA.ask('boomAsync', null), /kaputt-async/);
});

test('ask: timeout rejects', async () => {
  await assert.rejects(chA.ask('nobody', null, 30), /timeout \(30ms\)/);
});

test('origin allowlist: non-matching origins are ignored', () => {
  const strictA = makePeer('https://strict.test');
  const strictB = makePeer('https://evil.test');
  const chS = createChannel(strictA as never, { origin: 'https://strict.test', name: 'sec', listen: strictA as never });
  const evil = createChannel(strictB as never, { origin: 'https://strict.test', name: 'sec', listen: strictB as never });
  evil.remote = (data) => strictA.dispatch(data, 'https://evil.test');
  const got: unknown[] = [];
  chS.on('private', (p) => {
    got.push(p);
  });
  evil.send('private', 'stolen');
  assert.deepEqual(got, []);
});

test('close: rejects pending asks, stops delivery', async () => {
  const chB2 = createChannel(B as never, { origin: '*', name: 'closing', listen: B as never });
  const chA2 = createChannel(A as never, { origin: '*', name: 'closing', listen: A as never });
  const p = chA2.ask('never', null, 5000);
  chA2.close();
  await assert.rejects(p, /closed/);
  chA2.send('x', 1); // no-op, no throw
  void chB2;
});

test('channel name isolates traffic on the same pipe', () => {
  const chA3 = createChannel(A as never, { origin: '*', name: 'a3', listen: A as never });
  const chB3 = createChannel(B as never, { origin: '*', name: 'b3', listen: B as never });
  const got: unknown[] = [];
  chB3.on('t', (p) => {
    got.push(p);
  });
  chA3.send('t', 'lost');
  assert.deepEqual(got, []); // different channel names — no delivery
});
