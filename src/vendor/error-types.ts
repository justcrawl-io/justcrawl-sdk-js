/**
 * Structured error contract for the CLI / MCP / api-gateway path
 * (Phase 0.6, decision [D15]).
 *
 * The api-gateway's error middleware emits a `JustcrawlError` body when
 * the inbound `Accept` header advertises `JUSTCRAWL_MEDIA_TYPE` (set by
 * the CLI and MCP server); browsers fall through to the existing
 * `{ error: 'Something went wrong' }` shape — see
 * `services/api-gateway/src/error-middleware.ts`.
 *
 * Producers: api-gateway today, CLI + MCP renderers in Phase 4 / 3.
 * Consumers: CLI human + JSON output, MCP tool-error payload, future
 * dashboard error toasts.
 */

/**
 * Vendor media-type the CLI + MCP server send on every request via the
 * `Accept` header to opt into the structured error contract. Bumping the
 * `v1` suffix is how a future breaking change to JustcrawlError ships.
 */
export const JUSTCRAWL_MEDIA_TYPE = 'application/vnd.justcrawl.v1+json';

/**
 * Closed enum of customer-visible error codes. New codes are added here;
 * server code throws `HttpError` with the code and the middleware looks
 * up the static message + status from the tables below.
 *
 * Codes are stable contract — renaming a code is a customer-breaking
 * change and requires a deprecation cycle. Adding a new code is fine.
 */
export type JustcrawlErrorCode =
  // Auth (4)
  | 'auth_missing'
  | 'auth_invalid'
  | 'auth_forbidden'
  | 'auth_org_mismatch'
  // Validation (4)
  | 'invalid_url'
  | 'invalid_workflow'
  | 'invalid_input'
  | 'node_type_unknown'
  // Resource (3)
  | 'not_found'
  | 'workflow_disabled'
  | 'org_not_found'
  // Quota / billing (3)
  | 'quota_exceeded'
  | 'plan_required'
  | 'payment_required'
  // State / conflict (3)
  | 'conflict'
  | 'already_exists'
  | 'job_terminal'
  // CLI device-flow lifecycle (2) — distinct from generic auth_invalid because
  // RFC 8628 wants 410 Gone for expired/consumed codes so the CLI can stop
  // polling deterministically.
  | 'auth_code_expired'
  | 'auth_code_consumed'
  // Server / external (3)
  | 'provider_unavailable'
  | 'internal_error'
  | 'service_unavailable';

/**
 * Predefined customer-facing message per code. MUST be a literal string —
 * never interpolate request input. Tests assert no occurrence of `${` in
 * any value (see `services/api-gateway/src/__tests__/error-contract.test.ts`).
 */
export const STATIC_MESSAGES: Record<JustcrawlErrorCode, string> = {
  auth_missing: 'Authentication required. Provide a bearer token or API key.',
  auth_invalid: 'The provided credentials are invalid, expired, or revoked.',
  auth_forbidden: 'You do not have permission to perform this action.',
  auth_org_mismatch: 'The resource belongs to a different organization.',

  invalid_url: 'The URL is malformed or missing a scheme. Use https:// or http://.',
  invalid_workflow: 'The workflow JSON is malformed or fails DAG validation.',
  invalid_input: 'One or more request fields are missing or malformed.',
  node_type_unknown: 'The workflow uses an unrecognized node type.',

  not_found: 'The requested resource does not exist.',
  workflow_disabled: 'The workflow is disabled. Re-enable it before submitting jobs.',
  org_not_found: 'The organization does not exist or is not accessible.',

  quota_exceeded: 'Rate limit or quota exceeded. Slow down or contact support to raise it.',
  plan_required: 'This feature requires a higher plan tier.',
  payment_required: 'Payment is required. Update billing in the dashboard to continue.',

  conflict: 'The request conflicts with the current state of the resource.',
  already_exists: 'A resource with that identifier already exists.',
  job_terminal: 'The job is already in a terminal state and cannot be modified.',

  auth_code_expired: 'The authorization code has expired. Start a new CLI login flow.',
  auth_code_consumed: 'The authorization code has already been used. Start a new CLI login flow.',

  provider_unavailable: 'The upstream scraping provider is temporarily unavailable.',
  internal_error: 'An unexpected error occurred. The team has been notified.',
  service_unavailable: 'The service is temporarily unavailable. Try again shortly.',
};

/**
 * HTTP status code per error code. The middleware uses this to set the
 * response status when the route handler doesn't override.
 */
export const STATUS_BY_CODE: Record<JustcrawlErrorCode, number> = {
  auth_missing: 401,
  auth_invalid: 401,
  auth_forbidden: 403,
  auth_org_mismatch: 403,

  invalid_url: 400,
  invalid_workflow: 400,
  invalid_input: 400,
  node_type_unknown: 400,

  not_found: 404,
  workflow_disabled: 409,
  org_not_found: 404,

  quota_exceeded: 429,
  plan_required: 402,
  payment_required: 402,

  conflict: 409,
  already_exists: 409,
  job_terminal: 409,

  auth_code_expired: 410,
  auth_code_consumed: 410,

  provider_unavailable: 502,
  internal_error: 500,
  service_unavailable: 503,
};

/**
 * Where the docs page for this code lives — and it must be the route Astro
 * actually serves, not the one the contract wished for.
 *
 * This read `.../errors` from Phase 1 until 2026-08-30, written while the pages
 * were still unbuilt ("until those land each URL 404s"). The pages landed as
 * `guides/errors/{code}.mdx`, which Starlight serves at `/guides/errors/{code}/`
 * — but the constant never followed, so every `docs_url` the gateway has ever
 * emitted 404'd in production. Verified against the live site before the fix:
 * `/errors/not_found` → 404, `/guides/errors/not_found` → 200.
 *
 * The docs-deploy shape checks (`ci/deploy.yml`) now derive a `dist/` path from
 * this very string and assert the page exists, so the two cannot drift apart
 * again silently. If you move the pages, change this line and let CI confirm it.
 */
export const DOCS_BASE_URL = 'https://docs.justcrawl.io/guides/errors';

/**
 * Build the customer-facing docs URL for a code. Centralizes the format so a
 * future docs site move only touches `DOCS_BASE_URL`.
 */
export function getErrorDocsUrl(code: JustcrawlErrorCode): string {
  return `${DOCS_BASE_URL}/${code}`;
}

/**
 * Narrow an arbitrary string to a `JustcrawlErrorCode`.
 *
 * `STATIC_MESSAGES` is a `Record<JustcrawlErrorCode, string>`, so its key set
 * *is* the union — the compiler keeps this guard in sync for free, and there
 * is exactly one `apps/docs/.../guides/errors/<code>.mdx` page per key.
 *
 * Surfaces with their own local error vocabulary (the BI console emits
 * `invalid_sql`, `feature_disabled`, `saved_query_name_taken`, … which are
 * deliberately *not* union members) hold a plain `string` and must call this
 * before minting a docs URL. `getErrorDocsUrl` is typed against the union to
 * stop a non-member reaching it; this is the runtime half of that guard, so a
 * code with no documentation page never ships a link that 404s.
 */
export function isJustcrawlErrorCode(code: string): code is JustcrawlErrorCode {
  return Object.prototype.hasOwnProperty.call(STATIC_MESSAGES, code);
}

/**
 * Type-safe lookup against STATIC_MESSAGES — private to this module so the
 * un-typed string-index path can't escape. `buildJustcrawlError` is the only
 * caller; consumers go through that.
 */
function messageFor(code: JustcrawlErrorCode): string {
  return STATIC_MESSAGES[code];
}

/**
 * Type-safe status lookup. `HttpError` reads this so route handlers never
 * hardcode an HTTP code — `STATUS_BY_CODE` is the single source of truth.
 */
export function statusFor(code: JustcrawlErrorCode): number {
  return STATUS_BY_CODE[code];
}

/**
 * The on-wire response body the middleware emits when the request's Accept
 * header includes JUSTCRAWL_MEDIA_TYPE. Browsers receive the legacy
 * `{ error: 'Something went wrong' }` shape instead.
 *
 * `param` is set when the failure was a field-level validation error so
 * the CLI / MCP renderer can highlight which input was wrong.
 */
export interface JustcrawlError {
  error: {
    code: JustcrawlErrorCode;
    message: string;
    docs_url: string;
    request_id: string;
    param?: string;
  };
}

/**
 * Build a JustcrawlError body. Pure function — the middleware composes
 * `request_id` from the X-Request-ID header just before serializing.
 */
export function buildJustcrawlError(
  code: JustcrawlErrorCode,
  requestId: string,
  param?: string,
): JustcrawlError {
  return {
    error: {
      code,
      message: messageFor(code),
      docs_url: getErrorDocsUrl(code),
      request_id: requestId,
      ...(param ? { param } : {}),
    },
  };
}

/**
 * True when the inbound `Accept` header opts into the structured error
 * contract. Case-insensitive substring match — Express normalizes the
 * header to a single comma-joined string when multiple values are sent.
 */
export function acceptsJustcrawlMediaType(acceptHeader: string | undefined): boolean {
  if (!acceptHeader) return false;
  return acceptHeader.toLowerCase().includes(JUSTCRAWL_MEDIA_TYPE);
}
