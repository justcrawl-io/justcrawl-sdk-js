/**
 * Retry policy (KTD-2, R9).
 *
 * **Retries are GET-only.** The API has no `Idempotency-Key` support, and
 * `POST /api/v1/jobs` twice charges two credits — so a retried write is a
 * double charge, a duplicate schedule, or a duplicate workflow. No timeout
 * heuristic makes that safe, so POST/PATCH/PUT/DELETE are never retried at all,
 * not even on a network error where the request may never have landed.
 *
 * **429 IS retried.** The API returns 429 on the BI query mount
 * (`too_many_queries`), on the daily URL cap, and on extraction — where it also
 * sets `Retry-After`. Not every 429 carries that header, so the header is
 * honored when present and its absence is never an error.
 *
 * **402 is never retried.** Retrying an exhausted quota cannot succeed and just
 * spends the customer's time; it needs a human to add credits.
 */

/**
 * HTTP methods this SDK will retry — the safe ones, and only those.
 *
 * `HEAD` is here for completeness of the safe-method set; the API declares no
 * HEAD operation today, so in practice this is GET.
 */
const RETRYABLE_METHODS = new Set(['GET', 'HEAD']);

/** Statuses worth a second attempt on a safe method. */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface RetryPolicy {
  /** Attempts *after* the first. `0` disables retrying. */
  maxRetries: number;
  /** First backoff step, doubled per attempt. */
  baseDelayMs: number;
  /** Ceiling on any single backoff, including one derived from `Retry-After`. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
};

/**
 * Whether a *response* status should be retried for this method.
 *
 * @param method  HTTP method, any casing.
 * @param status  Response status.
 */
export function isRetryableResponse(method: string, status: number): boolean {
  if (!RETRYABLE_METHODS.has(method.toUpperCase())) return false;
  return RETRYABLE_STATUSES.has(status);
}

/**
 * Whether a *transport* failure (no response at all) should be retried.
 *
 * Same method restriction: a POST that failed mid-flight may still have been
 * processed, and the SDK has no way to find out.
 */
export function isRetryableTransportError(method: string): boolean {
  return RETRYABLE_METHODS.has(method.toUpperCase());
}

/**
 * Parse a `Retry-After` header value into seconds.
 *
 * Handles both RFC 7231 forms — delta-seconds and an HTTP-date — and returns
 * `undefined` for anything unparseable rather than throwing. A past date
 * clamps to 0, never a negative delay.
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  // Reject any other all-numeric form BEFORE trying the date branch. Date.parse
  // is startlingly permissive: `Date.parse('-5')` returns a real timestamp in
  // 2001, so a malformed `Retry-After: -5` would read as a date in the past,
  // clamp to 0, and turn the backoff off entirely — a hostile server could hold
  // a client at zero delay for every retry. A signed or otherwise non-plain
  // integer is a broken delta-seconds, not an HTTP-date.
  if (/^[+-]?[\d.]+$/.test(trimmed)) return undefined;

  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return undefined;
  return Math.max(0, Math.round((asDate - now) / 1000));
}

/**
 * How long to wait before attempt `attempt` (1-based: `1` is the first retry).
 *
 * A server-sent `Retry-After` wins — it is the only party that knows when the
 * window reopens — capped by `maxDelayMs` so a hostile or mistaken header can't
 * hang a caller for an hour. Otherwise: exponential backoff with full jitter,
 * which spreads a fleet of clients that all got rate-limited at the same instant
 * instead of resynchronizing them into a thundering herd.
 *
 * @param random Injectable for deterministic tests.
 */
export function computeDelayMs(
  attempt: number,
  retryAfterSeconds: number | undefined,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  if (retryAfterSeconds !== undefined) {
    return Math.min(retryAfterSeconds * 1000, policy.maxDelayMs);
  }
  const exponential = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  return Math.round(exponential * random());
}
