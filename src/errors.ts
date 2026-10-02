/**
 * Error mapping for the four wire shapes the API actually emits (KTD-3).
 *
 * The API emits a structured error object on some endpoints and a plain
 * `{ error: "..." }` on many more, and authentication failures use a shape of
 * their own. A client that assumed the structured form would mis-parse the
 * majority of real failures, so this module maps all four shapes and is
 * explicit about which half of the result came from the server: a `code` the
 * server actually sent, or one this SDK inferred from the status
 * (`inferredCode: true`, with the untouched body on `raw`).
 */

import { isJustcrawlErrorCode, type JustcrawlErrorCode } from './vendor/error-types.js';

/**
 * The `code` on a thrown error. Widened past the server's closed enum on
 * purpose: when no code is on the wire we infer one from the status, and two
 * useful inferences (`rate_limited`, `timeout`, `network_error`) have no member
 * in the server vocabulary at all. `inferredCode` tells the two apart — never
 * branch on a code without checking it.
 */
export type JustCrawlErrorCode = JustcrawlErrorCode | 'rate_limited' | 'timeout' | 'network_error';

/** Which of the four wire shapes this error was decoded from. */
export type ErrorWireShape = 'structured' | 'flat' | 'quota' | 'non-json' | 'transport';

export interface JustCrawlErrorInit {
  message: string;
  status: number;
  code: JustCrawlErrorCode;
  /** True when `code` was inferred from the HTTP status, not read off the wire. */
  inferredCode: boolean;
  shape: ErrorWireShape;
  requestId?: string;
  /** The response body exactly as received — parsed JSON, or a snippet of text. */
  raw?: unknown;
  docsUrl?: string;
  param?: string;
  retryAfterSeconds?: number;
  /**
   * Whether retrying this exact request could succeed.
   *
   * Set by the client from the same predicates the retry loop uses, so a caller
   * (or an agent) never has to re-derive the SDK's retry table by hand and watch
   * it drift. Left `undefined` when the SDK cannot know — an error constructed
   * outside a request, for instance.
   */
  retryable?: boolean;
  remainingCredits?: number;
  isTrialExpired?: boolean;
  plan?: string;
}

/**
 * Every failure the SDK throws.
 *
 * Note the capital C: this is the SDK's own class, deliberately distinct from
 * the server-side `JustcrawlError` *wire type* it decodes. It **never** carries
 * request headers or the client config — that is what keeps the customer's API
 * key out of logs, crash reporters, and bug reports (R10).
 */
export class JustCrawlError extends Error {
  readonly status: number;
  readonly code: JustCrawlErrorCode;
  readonly inferredCode: boolean;
  readonly shape: ErrorWireShape;
  readonly requestId?: string;
  readonly raw?: unknown;
  readonly docsUrl?: string;
  readonly param?: string;
  readonly retryAfterSeconds?: number;
  /**
   * Whether retrying this exact request could succeed — `false` on ordinary
   * writes (no idempotency key exists, so a retry can duplicate a charge or
   * mutation), `false` on a 402, and `true` on a retryable 429/5xx/network
   * failure to a GET or an explicitly idempotent BI submission.
   *
   * Read this instead of switching on `status` yourself: the SDK's own retry
   * loop is driven by the same predicates, so the two cannot disagree.
   */
  readonly retryable?: boolean;

  /** Set only on the 402 quota shape. */
  readonly remainingCredits?: number;
  readonly isTrialExpired?: boolean;
  readonly plan?: string;

  constructor(init: JustCrawlErrorInit) {
    super(init.message);
    this.name = 'JustCrawlError';
    this.status = init.status;
    this.code = init.code;
    this.inferredCode = init.inferredCode;
    this.shape = init.shape;
    this.requestId = init.requestId;
    this.raw = init.raw;
    this.docsUrl = init.docsUrl;
    this.param = init.param;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.retryable = init.retryable;
    this.remainingCredits = init.remainingCredits;
    this.isTrialExpired = init.isTrialExpired;
    this.plan = init.plan;
  }
}

/** The request exceeded `timeoutMs`. A subclass so `catch` blocks can single it out. */
export class JustCrawlTimeoutError extends JustCrawlError {
  constructor(timeoutMs: number, requestId?: string, retryable?: boolean) {
    super({
      message: `Request timed out after ${timeoutMs}ms`,
      status: 0,
      code: 'timeout',
      inferredCode: true,
      shape: 'transport',
      requestId,
      retryable,
    });
    this.name = 'JustCrawlTimeoutError';
  }
}

/** The request never got a response (DNS, TCP, TLS, offline). */
export class JustCrawlConnectionError extends JustCrawlError {
  constructor(cause: unknown, retryable?: boolean) {
    super({
      message: `Could not reach the JustCrawl API: ${cause instanceof Error ? cause.message : String(cause)}`,
      status: 0,
      code: 'network_error',
      inferredCode: true,
      shape: 'transport',
      retryable,
    });
    this.name = 'JustCrawlConnectionError';
    this.cause = cause;
  }
}

/** The caller aborted via their own `AbortSignal`. Never retried, never wrapped as a failure. */
export class JustCrawlAbortError extends JustCrawlError {
  constructor() {
    super({
      message: 'Request aborted by the caller',
      status: 0,
      code: 'network_error',
      inferredCode: true,
      shape: 'transport',
    });
    this.name = 'JustCrawlAbortError';
  }
}

/**
 * Best-effort code for a status with no code on the wire.
 *
 * Deliberately conservative — where a status maps to several plausible codes
 * (400 could be `invalid_url`, `invalid_workflow`, `node_type_unknown`…) it
 * picks the most general one rather than guessing a specific failure the server
 * never claimed. Everything here is returned with `inferredCode: true`.
 */
export function inferCodeFromStatus(status: number): JustCrawlErrorCode {
  switch (status) {
    case 400:
      return 'invalid_input';
    case 401:
      return 'auth_invalid';
    case 403:
      return 'auth_forbidden';
    case 402:
      return 'payment_required';
    case 404:
    case 410:
      return 'not_found';
    case 409:
      return 'conflict';
    // No member of the server's closed enum covers rate limiting — see
    // JustCrawlErrorCode. Flagged as inferred, so it can never be mistaken for
    // something the server said.
    case 429:
      return 'rate_limited';
    case 503:
      return 'service_unavailable';
    default:
      return status >= 500 ? 'internal_error' : 'invalid_input';
  }
}

/** Longest body snippet kept from a non-JSON response. Enough to identify a Cloudflare page. */
const NON_JSON_SNIPPET_MAX = 500;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Decode an error response into a `JustCrawlError`.
 *
 * @param status   HTTP status.
 * @param bodyText Raw response text (already read; may be empty).
 * @param requestId `X-Request-ID` response header, when present.
 * @param retryAfterSeconds Parsed `Retry-After`, when present and numeric.
 * @param retryable Whether retrying this exact request could succeed. Supplied
 *   by the caller (the client's retry loop) because it depends on the request
 *   METHOD, which a response alone does not carry — a 503 is retryable on a GET
 *   and not on a POST.
 */
export function errorFromResponse(
  status: number,
  bodyText: string,
  requestId?: string,
  retryAfterSeconds?: number,
  retryable?: boolean,
): JustCrawlError {
  let parsed: unknown;
  try {
    parsed = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
  } catch {
    parsed = undefined;
  }

  const body = asRecord(parsed);
  // Spread into all five shapes below, so a new branch cannot forget a field.
  const base = { status, requestId, retryAfterSeconds, retryable };

  // Shape 4 — non-JSON. Cloudflare HTML, an upstream proxy page, or a
  // `text/html` body from /result. Keep a snippet: the status alone rarely says
  // enough to debug one of these.
  if (body === undefined) {
    const snippet = bodyText.trim().slice(0, NON_JSON_SNIPPET_MAX);
    return new JustCrawlError({
      ...base,
      message: snippet.length > 0 ? `HTTP ${status}: ${snippet}` : `HTTP ${status}`,
      code: status >= 500 ? 'internal_error' : inferCodeFromStatus(status),
      inferredCode: true,
      shape: 'non-json',
      raw: bodyText.length > 0 ? snippet : undefined,
    });
  }

  // Shape 1 — the structured contract: `{ error: { code, message, docs_url, request_id } }`.
  // Emitted by the error middleware on the vendor media type, and unconditionally
  // by /api/v1/cli-auth/* and the BI handlers.
  const nested = asRecord(body.error);
  if (nested !== undefined && typeof nested.code === 'string') {
    return new JustCrawlError({
      ...base,
      message: typeof nested.message === 'string' ? nested.message : `HTTP ${status}`,
      // Used verbatim — this is a code the server actually stated, whether or
      // not it is a member of the shared enum (BI carries its own vocabulary:
      // invalid_sql, feature_disabled, saved_query_name_taken, …).
      code: nested.code as JustCrawlErrorCode,
      inferredCode: false,
      shape: 'structured',
      requestId: typeof nested.request_id === 'string' ? nested.request_id : requestId,
      docsUrl: typeof nested.docs_url === 'string' ? nested.docs_url : undefined,
      param: typeof nested.param === 'string' ? nested.param : undefined,
      raw: parsed,
    });
  }

  if (typeof body.error === 'string') {
    // Shape 3 — the 402 quota gate: `{ error: 'QUOTA_EXCEEDED', message, plan,
    // remainingCredits, isTrialExpired }`. A flat-string body by structure, but
    // its extra fields are the whole point of catching a 402, so it gets its own
    // branch. `auth/require-active-quota.ts` is the only emitter.
    if (body.error === 'QUOTA_EXCEEDED') {
      return new JustCrawlError({
        ...base,
        message: typeof body.message === 'string' ? body.message : 'Insufficient credits',
        code: 'quota_exceeded',
        // The server named QUOTA_EXCEEDED explicitly; `quota_exceeded` is that
        // same code in the shared enum's casing, not an inference.
        inferredCode: false,
        shape: 'quota',
        raw: parsed,
        remainingCredits: typeof body.remainingCredits === 'number' ? body.remainingCredits : undefined,
        isTrialExpired: typeof body.isTrialExpired === 'boolean' ? body.isTrialExpired : undefined,
        plan: typeof body.plan === 'string' ? body.plan : undefined,
      });
    }

    // Shape 2 — the flat string the ~560 ad-hoc sites emit, including every
    // hand-rolled 401 from auth/middleware.ts. The string is a human message,
    // never a code — unless it happens to be one, which a handful of older
    // sites do; check before treating it as either.
    const looksLikeCode = isJustcrawlErrorCode(body.error);
    return new JustCrawlError({
      ...base,
      message: body.error,
      code: looksLikeCode ? (body.error as JustcrawlErrorCode) : inferCodeFromStatus(status),
      inferredCode: !looksLikeCode,
      shape: 'flat',
      raw: parsed,
    });
  }

  // JSON, but none of the three known shapes. Keep the body; infer the code.
  return new JustCrawlError({
    ...base,
    message: `HTTP ${status}`,
    code: inferCodeFromStatus(status),
    inferredCode: true,
    shape: 'non-json',
    raw: parsed,
  });
}
