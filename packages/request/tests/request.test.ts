import { test } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as unknown as Record<string, unknown>;

type FetchStub = (url: string, init?: RequestInit) => Promise<Response>;

let stub: FetchStub = () => new Response('{}');
g.fetch = ((url: string, init?: RequestInit) => stub(url, init)) as typeof fetch;

const { request, create, RequestError } = await import('../src/index.ts');

const json = (data: unknown, status = 200, headers?: Record<string, string>): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

test('get: returns response envelope with parsed data', async () => {
  stub = (url) => {
    assert.equal(url, '/api/users');
    return json([{ id: 1 }]);
  };
  const res = await request.get<{ id: number }[]>('/api/users');
  assert.equal(res.status, 200);
  assert.equal(res.data[0]!.id, 1);
});

test('params: serialized, undefined/null skipped, objects JSON-stringified', async () => {
  stub = (url) => {
    assert.equal(url, '/api?b=2&a=1&f=%7B%22x%22%3A1%7D');
    return json({});
  };
  await request.get('/api', {
    params: { b: 2, a: 1, c: undefined, d: null, f: { x: 1 } },
  });
});

test('baseURL: joined when url is relative; absolute url wins', async () => {
  const inst = create({ baseURL: 'https://x.test/api/' });
  stub = (url) => {
    assert.equal(url, 'https://x.test/api/users');
    return json({});
  };
  await inst.get('users');
  stub = (url) => {
    assert.equal(url, 'https://other.test/full');
    return json({});
  };
  await inst.get('https://other.test/full');
});

test('post: plain-object body JSON-encoded with content-type', async () => {
  stub = (_url, init) => {
    assert.equal(init?.method, 'POST');
    assert.equal(init?.body, '{"name":"re"}');
    const h = init?.headers as Record<string, string>;
    assert.equal(h['Content-Type'], 'application/json;charset=UTF-8');
    return json({ ok: true }, 201);
  };
  const res = await request.post<{ ok: boolean }>('/api', { name: 're' });
  assert.equal(res.status, 201);
  assert.equal(res.data.ok, true);
});

test('post: FormData passes through untouched', async () => {
  stub = (_url, init) => {
    assert.ok(init?.body instanceof FormData);
    const h = init?.headers as Record<string, string>;
    assert.equal(h['Content-Type'], undefined); // browser sets multipart boundary
    return json({});
  };
  await request.post('/api', new FormData());
});

test('error: non-2xx throws RequestError with status + parsed data', async () => {
  stub = () => json({ message: 'nope' }, 404);
  try {
    await request.get('/api');
    assert.fail('must throw');
  } catch (err) {
    assert.ok(err instanceof RequestError);
    assert.equal((err as RequestError).status, 404);
    assert.deepEqual((err as RequestError).data, { message: 'nope' });
  }
});

test('error: timeout aborts and sets isTimeout', async () => {
  stub = (_url, init) =>
    new Promise((_res, rej) => {
      init!.signal!.addEventListener('abort', () =>
        rej(new DOMException('aborted', 'AbortError')),
      );
    });
  const t0 = Date.now();
  try {
    await request.get('/api', { timeout: 30 });
    assert.fail('must throw');
  } catch (err) {
    assert.ok(err instanceof RequestError);
    assert.equal((err as RequestError).isTimeout, true);
    assert.ok(Date.now() - t0 < 500);
  }
});

test('interceptors: before merges config, after transforms, errors recover', async () => {
  const inst = create();
  inst.before.use((cfg) => ({ ...cfg, headers: { ...cfg.headers, 'x-token': 't1' } }));
  inst.after.use((res) => ({ ...res, data: (res.data as { v: number }).v * 2 }));
  stub = (_url, init) => {
    assert.equal((init?.headers as Record<string, string>)['x-token'], 't1');
    return json({ v: 21 });
  };
  const res = await inst.get<{ then?: never } & number>('/api');
  assert.equal(res.data, 42);

  inst.errors.use((err) => {
    assert.ok(err instanceof RequestError);
    return 'recovered'; // non-Error return resolves the request
  });
  stub = () => json({}, 500);
  assert.equal(await inst.get('/api'), 'recovered');
});

test('responseType: text and arraybuffer', async () => {
  stub = () => new Response('hello', { status: 200 });
  const res = await request.get('/api', { responseType: 'text' });
  assert.equal(res.data, 'hello');
  stub = () => new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
  const buf = await request.get<ArrayBuffer>('/api', { responseType: 'arraybuffer' });
  assert.equal(buf.data.byteLength, 3);
});

test('create: defaults merge per-call config', async () => {
  const inst = create({ baseURL: 'https://d.test', headers: { 'x-a': '1' } });
  assert.equal(inst.defaults.baseURL, 'https://d.test');
  stub = (url, init) => {
    assert.equal(url, 'https://d.test/x');
    assert.equal((init?.headers as Record<string, string>)['x-a'], '1');
    assert.equal((init?.headers as Record<string, string>)['x-b'], '2');
    return json({});
  };
  await inst.get('/x', { headers: { 'x-b': '2' } });
});

test('external signal: aborts an in-flight request', async () => {
  const ac = new AbortController();
  stub = (_url, init) =>
    new Promise((_res, rej) => {
      init!.signal!.addEventListener('abort', () =>
        rej(new DOMException('aborted', 'AbortError')),
      );
    });
  const p = request.get('/api', { signal: ac.signal });
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(p, RequestError);
});
