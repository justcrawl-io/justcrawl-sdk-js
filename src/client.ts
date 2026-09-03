/**
 * The one request path every resource group goes through (R5, R8, R9, R10).
 */

import { JUSTCRAWL_MEDIA_TYPE } from './vendor/error-types.js';
import {
  JustCrawlAbortError,
  JustCrawlConnectionError,
  JustCrawlError,
  JustCrawlTimeoutError,
  errorFromResponse,
} from './errors.js';
import {
  DEFAULT_RETRY_POLICY,
  computeDelayMs,
  isRetryableResponse,
  isRetryableTransportError,
  parseRetryAfter,
  type RetryPolicy,
} from './retry.js';
import { AnalyticsResource } from './resources/analytics.js';
import { BenchmarksResource } from './resources/benchmarks.js';
import { BiResource } from './resources/bi.js';
import { ExtractionResource } from './resources/extraction.js';
import { IntegrationsResource } from './resources/integrations.js';
import { JobsResource } from './resources/jobs.js';
import { PlansResource } from './resources/plans.js';
import { SchedulesResource } from './resources/schedules.js';
import { SmartWorkflowsResource } from './resources/smart-workflows.js';
import { UrlsResource } from './resources/urls.js';
import { WebhooksResource } from './resources/webhooks.js';
import { WorkflowsResource } from './resources/workflows.js';
import { sleep } from './sleep.js';
import type { ApiPath, MethodOf, PathParamsOf, QueryOf, ResultOf } from './types.js';

/**
 * The production API host — the spec's `servers` entry.
 *
 * Worth knowing why this is called out: until 2026-08-30 both this constant and
 * the spec said `https://dashboard.justcrawl.io`, which is the Cloudflare Pages
 * frontend. Its SPA fallback answers `/api/v1/*` with `index.html` at
 * `200 text/html`, so every call failed as a non-JSON 200 rather than an honest
 * 404 — the SDK was unusable at its default. Fixed at the source
 * (`generate-openapi.ts` + the route JSDoc) and verified end to end against
 * production, and corroborated by the deploy configuration, which uses
 * `api.justcrawl.io` for the analytics push URL, the WorkOS OAuth redirect, and
 * the share endpoints.
 */
export const DEFAULT_BASE_URL = 'https://api.justcrawl.io';
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Minimal structural type for `fetch`, so injecting one needs no DOM lib. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface JustCrawlOptions {
  /** An `sr_live_…` API key from Settings → API Keys. */
  apiKey: string;
  /** Defaults to `https://api.justcrawl.io`. Override for staging or self-hosted. */
  baseUrl?: string;
  /** Per-request timeout. Defaults to 30s. */
  timeoutMs?: number;
  /** Retries for GET requests only. Defaults to 2. */
  maxRetries?: number;
  /** Injectable `fetch` — every test in this package uses it, so none need a live API. */
  fetch?: FetchLike;
}

export interface RequestOptions {
  /** Query parameters. `undefined` values are dropped; arrays repeat the key. */
  query?: QueryParams;
  /** JSON request body. */
  body?: unknown;
  /**
   * Values for the `{…}` placeholders in the path.
   *
   * Each is escaped with {@link encodePathParam} before substitution, so an id
   * containing `/` or `?` cannot retarget the request at a different endpoint.
   * The typed `request()` derives this object's shape from the spec; on
   * `requestUnchecked()` it is free-form.
   */
  path?: Record<string, string | number>;
  /** Caller cancellation, composed with the internal timeout signal. */
  signal?: AbortSignal;
  /** Override the client's timeout for this one call. */
  timeoutMs?: number;
  /** Extra headers. Cannot override `Authorization` — see `buildHeaders`. */
  headers?: Record<string, string>;
}

export type QueryValue = string | number | boolean | Date | undefined | null | Array<string | number | boolean>;
export type QueryParams = Record<string, QueryValue>;

/**
 * `RequestOptions` with `query` and `path` narrowed to the operation's own
 * parameters, so the typed `request()` rejects a filter the endpoint does not
 * accept and demands the path parameters it does.
 *
 * `path` is *conditionally* present: an endpoint with no `{…}` placeholder gets
 * `path?: never` (passing one is an error), and an endpoint with placeholders
 * gets them as a required object. That requiredness is why `request()`'s third
 * argument is a rest tuple rather than a plain `options?` — see the signature.
 */
export type TypedRequestOptions<P extends ApiPath, M extends MethodOf<P>> = Omit<
  RequestOptions,
  'query' | 'path'
> &
  ([PathParamsOf<P, M>] extends [never] ? { path?: never } : { path: PathParamsOf<P, M> }) & {
    query?: QueryOf<P, M>;
  };

/**
 * `request()`'s trailing argument, optional only when the endpoint takes no path
 * parameters.
 *
 * Without this, `options` would be plain-optional and
 * `request('get', '/api/v1/jobs/{id}')` would compile — issuing a literal
 * request to `…/jobs/%7Bid%7D`. Making the tuple conditional is what turns a
 * forgotten id into a compile error rather than a 404 at runtime.
 */
export type RequestArgs<P extends ApiPath, M extends MethodOf<P>> = [PathParamsOf<P, M>] extends [never]
  ? [options?: TypedRequestOptions<P, M>]
  : [options: TypedRequestOptions<P, M>];

/** Masked stand-in used everywhere the key would otherwise be rendered. */
export const MASKED_API_KEY = 'sr_live_****';

/**
 * A response whose body has already been read.
 *
 * `dispatch()` returns this rather than a live `Response` so the body read
 * happens inside the timeout/abort window (see `dispatch`). Carrying the text
 * instead of the stream also makes the body single-read by construction — a
 * `Response` can only be consumed once, and having two call sites that might
 * each want it is how that bug gets written.
 *
 * Internal: not exported from the package entry point.
 */
interface RawResponse {
  ok: boolean;
  status: number;
  url: string;
  headers: Headers;
  text: string;
}

/**
 * Serialize query parameters.
 *
 * - `undefined` and `null` are dropped entirely (so optional filters can be
 *   passed through unconditionally by wrappers).
 * - Arrays repeat the key (`?status=a&status=b`) — the shape the gateway's
 *   Express `req.query` parser produces an array from.
 * - `Date` serializes as an ISO-8601 string, the form every date-range filter in
 *   the spec documents.
 */
export function buildQueryString(query: QueryParams | undefined): string {
  if (query === undefined) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    const push = (v: string | number | boolean): void => {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    };
    if (Array.isArray(value)) {
      for (const item of value) push(item);
    } else if (value instanceof Date) {
      push(value.toISOString());
    } else {
      push(value);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/**
 * Escape a path parameter.
 *
 * Every resource wrapper routes its `{id}` through this. Without it an id
 * containing `/` or `?` would silently retarget the request at a different
 * endpoint — a path-traversal-shaped bug, not merely a 404.
 */
export function encodePathParam(value: string | number): string {
  return encodeURIComponent(String(value));
}

/**
 * Substitute `{name}` placeholders in a spec path template.
 *
 * Kept total rather than best-effort: a placeholder with no matching value
 * throws instead of being sent literally. The typed `request()` already makes
 * that case a compile error, so this only fires for `requestUnchecked()` — where
 * silently requesting `…/jobs/%7Bid%7D` would surface as a mystery 404 far from
 * the call site that caused it.
 *
 * @throws {JustCrawlError} when a placeholder has no value.
 */
export function interpolatePath(template: string, params: Record<string, string | number> | undefined): string {
  return template.replace(/\{([^{}]+)\}/g, (_match, name: string) => {
    const value = params?.[name];
    // An empty string has to fail here too. `''` is not "missing" to `??` or a
    // null check, but substituting it turns `/api/v1/jobs/{id}` into
    // `/api/v1/jobs` — a different, valid endpoint — so an unset variable would
    // silently LIST jobs instead of fetching one, or DELETE against a collection.
    // Better a typed error naming the placeholder than a request that succeeds
    // at the wrong URL.
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new JustCrawlError({
        message: `Path "${template}" needs a value for {${name}}`,
        status: 0,
        code: 'invalid_input',
        inferredCode: true,
        shape: 'transport',
      });
    }
    return encodePathParam(value);
  });
}

/** Join `baseUrl` and a path without doubling or dropping the separator. */
function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}



/**
 * The JustCrawl API client.
 *
 * ```ts
 * const jc = new JustCrawl({ apiKey: process.env.JUSTCRAWL_API_KEY! });
 * ```
 *
 * The `apiKey` is stored on a **non-enumerable** field and masked by both
 * `toJSON()` and Node's inspect hook, so it survives none of the usual accidental
 * exfiltration paths: `JSON.stringify(client)`, `console.log(client)`, a crash
 * reporter walking own properties, or a thrown error. It leaves the process only
 * as the `Authorization` header on a request to `baseUrl` (R10).
 */
export class JustCrawl {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly retryPolicy: RetryPolicy;

  /** One group per spec tag. See each group's module for what it covers. */
  readonly jobs: JobsResource;
  readonly workflows: WorkflowsResource;
  readonly smartWorkflows: SmartWorkflowsResource;
  readonly urls: UrlsResource;
  readonly schedules: SchedulesResource;
  readonly extraction: ExtractionResource;
  readonly analytics: AnalyticsResource;
  readonly benchmarks: BenchmarksResource;
  readonly plans: PlansResource;
  readonly integrations: IntegrationsResource;
  readonly webhooks: WebhooksResource;
  readonly bi: BiResource;

  /** Non-enumerable, assigned in the constructor. Never serialize this. */
  private readonly apiKey!: string;

  private readonly fetchImpl: FetchLike;

  constructor(options: JustCrawlOptions) {
    if (typeof options?.apiKey !== 'string' || options.apiKey.length === 0) {
      throw new JustCrawlError({
        message: 'apiKey is required — create one under Settings → API Keys',
        status: 0,
        code: 'auth_missing',
        inferredCode: true,
        shape: 'transport',
      });
    }

    // Non-enumerable so `Object.keys`, spread, `JSON.stringify`, and structured
    // clone all skip it. `toJSON` below covers the explicit-serialization path;
    // this covers everything that walks own enumerable properties instead.
    Object.defineProperty(this, 'apiKey', {
      value: options.apiKey,
      enumerable: false,
      writable: false,
      configurable: false,
    });

    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      maxRetries: options.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries,
    };

    const injected = options.fetch;
    if (injected === undefined && typeof globalThis.fetch !== 'function') {
      throw new JustCrawlError({
        message: 'No global fetch available — @justcrawl/sdk needs Node 20+, or pass your own `fetch`',
        status: 0,
        code: 'internal_error',
        inferredCode: true,
        shape: 'transport',
      });
    }
    this.fetchImpl = injected ?? ((input, init) => globalThis.fetch(input, init));

    this.jobs = new JobsResource(this);
    this.workflows = new WorkflowsResource(this);
    this.smartWorkflows = new SmartWorkflowsResource(this);
    this.urls = new UrlsResource(this);
    this.schedules = new SchedulesResource(this);
    this.extraction = new ExtractionResource(this);
    this.analytics = new AnalyticsResource(this);
    this.benchmarks = new BenchmarksResource(this);
    this.plans = new PlansResource(this);
    this.integrations = new IntegrationsResource(this);
    this.webhooks = new WebhooksResource(this);
    this.bi = new BiResource(this);
  }

  /** Masked view for `JSON.stringify`. */
  toJSON(): Record<string, unknown> {
    return {
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      apiKey: MASKED_API_KEY,
    };
  }

  /**
   * Masked view for `console.log` / `util.inspect`.
   *
   * Keyed by `Symbol.for('nodejs.util.inspect.custom')` rather than importing
   * `node:util` — same symbol, but it keeps the bundle free of a Node builtin
   * import, which matters for a zero-dependency artifact that bundlers process.
   */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `JustCrawl { baseUrl: '${this.baseUrl}', apiKey: '${MASKED_API_KEY}' }`;
  }

  /**
   * Issue one API request against a **documented** path — fully typed from the
   * spec. An unknown path, a method the path does not define, or a missing path
   * parameter is a compile error, and the return type is that operation's own
   * success body.
   *
   * Paths are the spec's own templates, with values passed separately. That is
   * the whole mechanism: `'/api/v1/jobs/{id}'` is a member of the `ApiPath`
   * union and so is checked against the spec, whereas an interpolated
   * `` `/api/v1/jobs/${id}` `` is just `string` and is checked against nothing.
   *
   * ```ts
   * const account = await jc.request('get', '/api/v1/account');
   * const job = await jc.request('get', '/api/v1/jobs/{id}', { path: { id } });
   * ```
   *
   * For an endpoint this SDK version does not document, use
   * {@link JustCrawl.requestUnchecked} — deliberately a separate method, because
   * as a second overload of this one it silently accepted every typo'd path
   * (see `src/__tests__/paths.test.ts` for the sweep that now guards this).
   */
  request<P extends ApiPath, M extends MethodOf<P>>(
    method: M,
    path: P,
    ...args: RequestArgs<P, M>
  ): Promise<ResultOf<P, M>> {
    return this.send(method, path, (args[0] ?? {}) as RequestOptions) as Promise<ResultOf<P, M>>;
  }

  /**
   * Issue one API request against any path, documented or not — **unchecked**.
   *
   * The escape hatch, and deliberately an opt-in one. A preview endpoint, or one
   * published after this SDK version was cut, still works; you supply the
   * response type and accept that nothing validates the path.
   *
   * This used to be a second overload of {@link JustCrawl.request}. It could not
   * stay one: an overload accepting `string` matches everything the
   * literal-union overload would have rejected, so `request('get',
   * '/api/v1/jobsss')` and `request('delete', '/api/v1/jobs/{id}')` both compiled
   * clean. The type safety was advertised in the docs and absent in fact. Naming
   * the unsafe form is what makes the safe form mean something.
   *
   * ```ts
   * const preview = await jc.requestUnchecked<{ ok: boolean }>('get', '/api/v1/preview/thing');
   * ```
   */
  requestUnchecked<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    return this.send(method, path, options) as Promise<T>;
  }

  /**
   * The single implementation behind both public forms — every resource wrapper
   * and every escape-hatch call funnels through here, so auth, retries,
   * timeouts, and error mapping have exactly one home (R6).
   *
   * @returns The parsed JSON body, or `undefined` for a 204 / empty 2xx.
   * @throws {JustCrawlError} on any non-2xx, timeout, or transport failure.
   */
  private async send(method: string, path: string, options: RequestOptions = {}): Promise<unknown> {
    const url = joinUrl(this.baseUrl, interpolatePath(path, options.path)) + buildQueryString(options.query);
    const upperMethod = method.toUpperCase();
    const maxAttempts = this.retryPolicy.maxRetries + 1;

    let lastError: JustCrawlError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: RawResponse;
      try {
        response = await this.dispatch(upperMethod, url, options);
      } catch (err) {
        if (err instanceof JustCrawlAbortError) throw err;
        // A timeout on a GET is retryable for the same reason a 504 is: no
        // response means no committed side effect on a safe method. The verdict
        // is stamped onto the error so a caller can read `err.retryable` instead
        // of reconstructing this table — see JustCrawlError.retryable.
        const transportRetryable = isRetryableTransportError(upperMethod);
        const wrapped =
          err instanceof JustCrawlTimeoutError
            ? new JustCrawlTimeoutError(options.timeoutMs ?? this.timeoutMs, undefined, transportRetryable)
            : new JustCrawlConnectionError(err, transportRetryable);
        if (attempt < maxAttempts && transportRetryable) {
          lastError = wrapped;
          await sleep(computeDelayMs(attempt, undefined, this.retryPolicy), options.signal);
          continue;
        }
        throw wrapped;
      }

      if (response.ok) return this.parseBody(response);

      const requestId = response.headers.get('X-Request-ID') ?? undefined;
      const retryAfterSeconds = parseRetryAfter(response.headers.get('Retry-After'));
      const responseRetryable = isRetryableResponse(upperMethod, response.status);
      const error = errorFromResponse(
        response.status,
        response.text,
        requestId,
        retryAfterSeconds,
        responseRetryable,
      );

      if (attempt < maxAttempts && responseRetryable) {
        lastError = error;
        await sleep(computeDelayMs(attempt, retryAfterSeconds, this.retryPolicy), options.signal);
        continue;
      }

      throw error;
    }

    // Unreachable: the loop either returns or throws on its final attempt. Kept
    // total so the type checker needs no non-null assertion.
    /* istanbul ignore next */
    throw lastError ?? new JustCrawlConnectionError(new Error('retries exhausted'));
  }

  /**
   * One attempt: build headers, arm the timeout, call `fetch`, **and read the
   * body** — all inside the same armed window.
   *
   * Reading the body here rather than in `request()` is the whole point. A
   * `fetch` promise settles when the response HEADERS arrive; the body is still
   * streaming. If the timer were cleared and the caller's abort listener removed
   * at that moment, every body read would run with no timeout and no
   * cancellation — a server that sent headers and then stalled would hang the
   * caller forever, and `timeoutMs` would silently mean "time to first byte"
   * rather than "time to a usable result".
   *
   * It also keeps mid-body failures inside the `catch` below, so a connection
   * reset during the body surfaces as a typed `JustCrawlTimeoutError` /
   * `JustCrawlAbortError` / `JustCrawlConnectionError` like every other
   * transport failure — and, on a GET, is retryable for the same reason.
   */
  private async dispatch(method: string, url: string, options: RequestOptions): Promise<RawResponse> {
    // An already-aborted signal must not produce a request. `delay()` above
    // checks this; without the same check here the first attempt goes over the
    // wire — and for a POST that means a charged job the caller believed they
    // had cancelled. `addEventListener('abort')` alone cannot cover this: on an
    // already-aborted signal the event has already fired and will not fire again.
    //
    // Read into a local first. Testing `options.signal?.aborted === true`
    // directly would let TypeScript narrow that PROPERTY to `false` for the rest
    // of the function — but `aborted` is a mutable flag that flips during the
    // `await` below, so the narrowing is unsound and would turn the identical
    // check in the `catch` into a "no overlap" compile error (or, worse under a
    // looser config, silently dead code).
    const alreadyAborted = options.signal?.aborted;
    if (alreadyAborted === true) throw new JustCrawlAbortError();

    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const onCallerAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onCallerAbort, { once: true });

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: this.buildHeaders(options),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      return {
        ok: response.ok,
        status: response.status,
        url: response.url,
        headers: response.headers,
        text: await response.text(),
      };
    } catch (err) {
      // Disambiguate the three reasons an abort surfaces here. Without this the
      // caller gets a bare `DOMException: This operation was aborted` and cannot
      // tell a timeout from their own cancellation.
      if (timedOut) throw new JustCrawlTimeoutError(timeoutMs);
      if (options.signal?.aborted === true) throw new JustCrawlAbortError();
      throw err;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  /**
   * Compose request headers.
   *
   * The SDK's own headers are applied **last**, so a caller-supplied header can
   * never displace them — silently swapping the key would send the request
   * unauthenticated, or worse, with someone else's credential.
   *
   * "Applied last" is necessary but NOT sufficient, which is the subtle part.
   * HTTP header names are case-insensitive but **object keys are not**: a caller
   * passing `authorization` (lowercase) survives the spread as a second, distinct
   * key alongside our `Authorization`, and `fetch`'s `Headers` constructor then
   * COMBINES same-named values rather than letting the later one win:
   *
   *   { ...{ authorization: 'X' }, Authorization: 'Bearer k' }
   *     -> outgoing header: `authorization: X, Bearer k`
   *
   * So the caller's value is sent, the key is smuggled alongside it, and the
   * request fails authentication in a way that reads like a bad key. Reserved
   * names are therefore filtered out of the caller's map by CASE-FOLDED
   * comparison before ours are applied.
   */
  private buildHeaders(options: RequestOptions): Record<string, string> {
    const reserved = new Set(['authorization', 'accept', 'content-type']);
    const callerHeaders = Object.fromEntries(
      Object.entries(options.headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase())),
    );

    const headers: Record<string, string> = {
      ...callerHeaders,
      // Opts into the structured `JustcrawlError` contract wherever the gateway
      // honors it — the middleware switches on this exact media type.
      Accept: JUSTCRAWL_MEDIA_TYPE,
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  /**
   * Read a successful response body.
   *
   * A 204 or any zero-length 2xx resolves to `undefined` rather than throwing a
   * JSON parse error — five wrapped DELETE endpoints return 204.
   */
  private parseBody(response: RawResponse): unknown {
    if (response.status === 204) return undefined;
    const text = response.text;
    if (text.length === 0) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      // A 2xx that isn't JSON is a SERVER contract violation, not a caller
      // error — so it is built directly rather than through errorFromResponse,
      // whose status-based inference would label a 200 `invalid_input` and point
      // the customer at their own request.
      throw new JustCrawlError({
        message: `Expected JSON from ${response.url || 'the API'} but got a non-JSON ${response.status} response`,
        status: response.status,
        code: 'internal_error',
        inferredCode: true,
        shape: 'non-json',
        requestId: response.headers.get('X-Request-ID') ?? undefined,
        raw: text.slice(0, 500),
      });
    }
  }
}
