# @zhenre/request

Axios-shaped client on native `fetch`. Zero dependencies.

```ts
import { request, create, RequestError } from '@zhenre/request';

const res = await request.get<User[]>('/api/users', { params: { active: true } });
res.data; res.status; res.headers;

const inst = create({ baseURL: 'https://api.test', timeout: 5000 });
inst.before.use((cfg) => ({ ...cfg, headers: { ...cfg.headers, Authorization: token() } }));
inst.after.use((res) => (res.data = unwrap(res.data), res));
inst.errors.use((err) => (refresh(), Promise.reject(err)));

try {
  await inst.post('/login', { user, pass });
} catch (err) {
  if (err instanceof RequestError && err.isTimeout) retry();
  else console.log(err.status, err.data);
}
```

- Plain-object bodies are JSON-encoded (`Content-Type` set unless provided); FormData/Blob pass through untouched.
- `params` serialization skips `undefined`/`null`, JSON-stringifies objects.
- Timeout = `AbortController`; `err.isTimeout` distinguishes it from external aborts.
- Non-2xx throws `RequestError { status, data, config }` — response interceptors still run only on success (axios semantics); error interceptors can recover by returning a non-Error value.
- `create()` merges defaults per call; `headers` merge two levels deep.
