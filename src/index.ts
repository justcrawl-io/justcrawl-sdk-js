/**
 * `@justcrawl/sdk` — the public entry point.
 *
 * Everything a customer can reach is re-exported here, and the manifest's
 * `exports` map has a single entry pointing at this module — so this file *is*
 * the public surface. Anything not exported below is internal and may change
 * without a major bump.
 *
 * (Internal note: the workspace name is `@scraperoute/sdk-js` and stays
 * `private: true`; the npm name is generated, never the source manifest's —
 * KTD-1. This file ships to the public mirror, so the claim above is written to
 * hold in both trees.)
 */

export { JustCrawl, DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, MASKED_API_KEY } from './client.js';
export type { JustCrawlOptions, RequestOptions, TypedRequestOptions, FetchLike, QueryParams, QueryValue } from './client.js';

export {
  JustCrawlError,
  JustCrawlTimeoutError,
  JustCrawlConnectionError,
  JustCrawlAbortError,
  inferCodeFromStatus,
} from './errors.js';
export type { JustCrawlErrorCode, JustCrawlErrorInit, ErrorWireShape } from './errors.js';

// `isRetryableResponse` / `isRetryableTransportError` are exported so a caller
// can ask the SDK's own retry table a question BEFORE making a request (e.g.
// deciding whether a queued job is worth re-dispatching). After a request, read
// `err.retryable` — the client stamps it from these same predicates.
export {
  DEFAULT_RETRY_POLICY,
  isRetryableResponse,
  isRetryableTransportError,
  parseRetryAfter,
} from './retry.js';
export type { RetryPolicy } from './retry.js';

export {
  JobWaitTimeoutError,
  fetchJobResult,
  isIndexingPending,
  waitForExtractionResult,
  waitForJob,
} from './polling.js';
export type { PollOptions, JobResultOutcome, ExtractionIndexingPending } from './polling.js';

export { isTerminalStatus, TERMINAL_JOB_STATUSES, NON_TERMINAL_JOB_STATUSES } from './types.js';
export type {
  ApiPath,
  BodyOf,
  HttpMethod,
  Job,
  JobStatus,
  MethodOf,
  NonTerminalJobStatus,
  Operation,
  QueryOf,
  ResultOf,
  Schema,
  SchemaName,
  SuccessBody,
  TerminalJobStatus,
} from './types.js';

/**
 * The raw generated spec types.
 *
 * Exported so callers can name a request or response shape without re-declaring
 * it — e.g. `ResultOf<'/api/v1/jobs', 'get'>`. `operations` is empty by
 * construction (the spec carries no `operationId` values), so index through
 * `paths`.
 */
export type { components, paths } from './generated/api.js';

export type { CallOptions } from './resources/base.js';
export { AnalyticsResource } from './resources/analytics.js';
export { BenchmarksResource } from './resources/benchmarks.js';
export { BiResource } from './resources/bi.js';
export { ExtractionResource } from './resources/extraction.js';
export { IntegrationsResource } from './resources/integrations.js';
export { JobsResource } from './resources/jobs.js';
export { PlansResource } from './resources/plans.js';
export { SchedulesResource } from './resources/schedules.js';
export { SmartWorkflowsResource } from './resources/smart-workflows.js';
export { UrlsResource } from './resources/urls.js';
export { WebhooksResource } from './resources/webhooks.js';
export { WorkflowsResource } from './resources/workflows.js';
