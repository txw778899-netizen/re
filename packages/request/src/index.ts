/**
 * @zhenre/request — axios-shaped client on native fetch
 *
 * Semantics follow axios where it matters, sized like everything @zhenre:
 *
 *   request(config)                    → Promise<ReResponse>
 *   request.get/post/put/patch/delete/head/options(url, …)
 *   create(defaults)                   → instance with its own interceptors
 *   inst.before.use(cfg => cfg)        request interceptors (in order)
 *   inst.after.use(res => res)         response interceptors (in order, ok only)
 *   inst.errors.use(err => err)        error interceptors; returning a
 *                                      non-Error value recovers the request
 *
 * Non-error response (status >= 400) throws `RequestError` carrying
 * `status`, `data`, `config`. Timeout is an AbortController with `isTimeout`
 * set on the error. Plain-object bodies are JSON-encoded automatically.
 */

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

export type ResponseType = 'json' | 'text' | 'blob' | 'arraybuffer';

export interface RequestConfig {
  url?: string;
  method?: string;
  baseURL?: string;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
  /** Milliseconds; aborted with `isTimeout` set on the error. */
  timeout?: number;
  responseType?: ResponseType;
  signal?: AbortSignal;
  withCredentials?: boolean;
}

export interface ReResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
  config: RequestConfig;
}

export interface RequestErrorInit {
  status?: number;
  data?: unknown;
  config?: RequestConfig;
  isTimeout?: boolean;
  cause?: unknown;
}

export class RequestError extends Error {
  status?: number;
  data?: unknown;
  config?: RequestConfig;
  isTimeout?: boolean;
  constructor(message: string, init?: RequestErrorInit) {
    super(message);
    this.name = 'RequestError';
    this.status = init?.status;
    this.data = init?.data;
    this.config = init?.config;
    this.isTimeout = init?.isTimeout;
    if (init?.cause !== undefined) this.cause = init.cause;
  }
}

export type BeforeFn = (config: RequestConfig) => RequestConfig | Promise<RequestConfig>;
export type AfterFn = (res: ReResponse) => ReResponse | Promise<ReResponse>;
export type ErrorFn = (error: unknown) => unknown;

export interface RequestInstance {
  <T = unknown>(config: RequestConfig): Promise<ReResponse<T>>;
  get<T = unknown>(url: string, config?: RequestConfig): Promise<ReResponse<T>>;
  post<T = unknown>(url: string, body?: unknown, config?: RequestConfig): Promise<ReResponse<T>>;
  put<T = unknown>(url: string, body?: unknown, config?: RequestConfig): Promise<ReResponse<T>>;
  patch<T = unknown>(url: string, body?: unknown, config?: RequestConfig): Promise<ReResponse<T>>;
  delete<T = unknown>(url: string, config?: RequestConfig): Promise<ReResponse<T>>;
  head<T = unknown>(url: string, config?: RequestConfig): Promise<ReResponse<T>>;
  options<T = unknown>(url: string, config?: RequestConfig): Promise<ReResponse<T>>;
  defaults: RequestConfig;
  before: { use(fn: BeforeFn): void };
  after: { use(fn: AfterFn): void };
  errors: { use(fn: ErrorFn): void };
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v) as object | null;
  return proto === Object.prototype || proto === null;
}

function buildURL(config: RequestConfig): string {
  let u = config.url ?? '';
  if (config.baseURL && !/^https?:\/\//.test(u)) {
    u = config.baseURL.replace(/\/+$/, '') + '/' + u.replace(/^\/+/, '');
  }
  const params = config.params;
  if (params !== undefined) {
    const sp = new URLSearchParams();
    for (const k of Object.keys(params)) {
      const v = params[k];
      if (v === undefined || v === null) continue;
      sp.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    const qs = sp.toString();
    if (qs !== '') u += (u.indexOf('?') >= 0 ? '&' : '?') + qs;
  }
  return u;
}

async function parseBody(res: Response, rt: ResponseType): Promise<unknown> {
  if (rt === 'json') {
    try {
      return await res.json();
    } catch {
      return null; // empty body / invalid JSON — axios-style leniency
    }
  }
  if (rt === 'text') return res.text();
  if (rt === 'blob') return res.blob();
  return res.arrayBuffer();
}

type Pipeline = { before: BeforeFn[]; after: AfterFn[]; errors: ErrorFn[] };

async function dispatch(
  config: RequestConfig,
  chain: Pipeline,
): Promise<ReResponse> {
  let timedOut = false;
  try {
    let cfg = config;
    for (let i = 0; i < chain.before.length; i++) cfg = await chain.before[i]!(cfg);

    const url = buildURL(cfg);
    const headers: Record<string, string> = {};
    if (cfg.headers !== undefined) Object.assign(headers, cfg.headers);
    let body = cfg.body;
    if (isPlainObject(body)) {
      body = JSON.stringify(body);
      if (headers['Content-Type'] === undefined && headers['content-type'] === undefined) {
        headers['Content-Type'] = 'application/json;charset=UTF-8';
      }
    }

    const controller = new AbortController();
    const timer =
      cfg.timeout !== undefined && cfg.timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, cfg.timeout)
        : null;
    if (cfg.signal !== undefined) {
      if (cfg.signal.aborted) controller.abort();
      else cfg.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const res = await fetch(url, {
        method: (cfg.method ?? 'GET').toUpperCase(),
        headers,
        body: body as BodyInit | null | undefined,
        signal: controller.signal,
        credentials: cfg.withCredentials === true ? 'include' : 'same-origin',
      });
      if (!res.ok) {
        const data = await parseBody(res, cfg.responseType ?? 'json');
        throw new RequestError(`Request failed with status ${res.status}`, {
          status: res.status,
          data,
          config: cfg,
        });
      }
      const data = await parseBody(res, cfg.responseType ?? 'json');
      let response: ReResponse = {
        data,
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
        config: cfg,
      };
      for (let i = 0; i < chain.after.length; i++) response = await chain.after[i]!(response);
      return response;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  } catch (err) {
    let error: RequestError;
    if (err instanceof RequestError) {
      error = err;
    } else if (timedOut) {
      error = new RequestError('timeout of ' + (config.timeout ?? 0) + 'ms exceeded', {
        config,
        isTimeout: true,
        cause: err,
      });
    } else if (timedAbort(err)) {
      // external signal aborted — not a timeout
      error = new RequestError('aborted', { config, cause: err });
    } else {
      error = new RequestError(
        err instanceof Error ? err.message : String(err),
        { config, cause: err },
      );
    }
    let out: unknown = error;
    for (let i = 0; i < chain.errors.length; i++) out = await chain.errors[i]!(out);
    if (out instanceof Error) throw out;
    return out as ReResponse;
  }
}

function timedAbort(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'AbortError'
  );
}

/* ------------------------------------------------------------------ */
/* factory                                                             */
/* ------------------------------------------------------------------ */

export function create(defaults: RequestConfig = {}): RequestInstance {
  const chain: Pipeline = { before: [], after: [], errors: [] };
  const base: RequestConfig = { ...defaults };
  const inst = ((config: RequestConfig) => {
    const merged: RequestConfig = { ...base, ...config };
    // headers merge two levels deep (axios semantics)
    if (base.headers !== undefined && config.headers !== undefined) {
      merged.headers = { ...base.headers, ...config.headers };
    }
    return dispatch(merged, chain);
  }) as RequestInstance;
  inst.get = (url, config) => inst({ ...config, url, method: 'GET' });
  inst.post = (url, body, config) => inst({ ...config, url, body, method: 'POST' });
  inst.put = (url, body, config) => inst({ ...config, url, body, method: 'PUT' });
  inst.patch = (url, body, config) => inst({ ...config, url, body, method: 'PATCH' });
  inst.delete = (url, config) => inst({ ...config, url, method: 'DELETE' });
  inst.head = (url, config) => inst({ ...config, url, method: 'HEAD' });
  inst.options = (url, config) => inst({ ...config, url, method: 'OPTIONS' });
  inst.defaults = base;
  inst.before = { use: (fn) => chain.before.push(fn) };
  inst.after = { use: (fn) => chain.after.push(fn) };
  inst.errors = { use: (fn) => chain.errors.push(fn) };
  return inst;
}

/** Shared default instance. */
export const request: RequestInstance = create();
