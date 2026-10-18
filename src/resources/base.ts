/**
 * Shared base for every resource group.
 *
 * A resource group is a thin, *typed* naming layer over `client.request()` — it
 * owns no transport behavior of its own. Auth, retries, timeouts, and error
 * mapping all live in `client.ts`, so there is exactly one place any of them can
 * be got wrong.
 *
 * One module per spec tag. `Authentication`, `Account`, and `Audit` deliberately
 * have no group, for two different reasons worth keeping apart. The auth
 * endpoints mint and refresh *JWTs* — a flow the dashboard and CLI own, and one
 * an `sr_live_…` caller never enters. Account deletion, GDPR export, and audit
 * logs are not like that: an API key reaches them exactly as it reaches jobs or
 * urls. They are ungrouped because they are deliberate, rarely-automated
 * operations that should not be fronted by a one-line typed helper — not
 * because a key cannot call them. Both remain reachable through
 * `client.request()`, typed against the spec like any other path.
 */

import type { JustCrawl, QueryParams, RequestOptions } from '../client.js';
import { JustCrawlAbortError, JustCrawlConnectionError, JustCrawlError, JustCrawlTimeoutError } from '../errors.js';

export abstract class Resource {
  constructor(protected readonly client: JustCrawl) {}

  /**
   * Narrow a generated query-parameter object to the transport's loose
   * `QueryParams`.
   *
   * The generated types describe each endpoint's parameters precisely (literal
   * unions for enums, `number` for pages); `buildQueryString` accepts the general
   * shape. The two are structurally compatible but TypeScript will not infer the
   * widening across an index signature, so the cast happens once here rather than
   * ~99 times at the call sites — and stays visible as a single reviewable seam.
   */
  protected q(query: unknown): QueryParams | undefined {
    return query as QueryParams | undefined;
  }

  /**
   * Forward per-call options (`signal`, `timeoutMs`, `headers`) without repeating
   * the spread.
   *
   * Generic in `extra` on purpose. `request()`'s options type is now narrowed per
   * operation — `path` is required for a templated endpoint and `path?: never`
   * for a flat one — so a helper returning the loose `RequestOptions` would be
   * rejected at every one of the ~101 call sites. Preserving `extra`'s literal
   * type lets the narrowed shape survive the merge.
   */
  protected opts<T extends object>(options: CallOptions | undefined, extra: T): CallOptions & T {
    return { ...options, ...extra };
  }
}

/** Options every wrapper method accepts on top of its own arguments. */
export type CallOptions = Pick<RequestOptions, 'signal' | 'timeoutMs' | 'headers'>;

/** Per-invocation cancellation and a caller-owned BatchJob recovery key. */
export type RunSubmissionOptions = CallOptions & Pick<RequestOptions, 'idempotencyKey'>;

/** Normalize one key before dispatch, rejecting conflicting case-insensitive header values. */
export function normalizeRunSubmissionOptions(options?: RunSubmissionOptions): RunSubmissionOptions & { idempotencyKey: string } {
  const headers = { ...(options?.headers ?? {}) };
  const normalize = (value: string): string => {
    try { return new Headers({ 'Idempotency-Key': value }).get('Idempotency-Key')!; }
    catch {
      throw new JustCrawlError({ message: 'Idempotency-Key must be a valid HTTP header value', status: 0,
        code: 'invalid_input', inferredCode: true, shape: 'transport' });
    }
  };
  let key = options?.idempotencyKey === undefined ? undefined : normalize(options.idempotencyKey);
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'idempotency-key') continue;
    const normalized = normalize(value);
    if (key !== undefined && key !== normalized) {
      throw new JustCrawlError({ message: 'Conflicting idempotency keys', status: 0,
        code: 'invalid_input', inferredCode: true, shape: 'transport' });
    }
    key = normalized;
    delete headers[name];
  }
  key ??= globalThis.crypto.randomUUID();
  if (typeof key !== 'string' || key.length === 0 || key.length > 256) {
    throw new JustCrawlError({ message: 'Idempotency-Key must contain 1 to 256 characters', status: 0,
      code: 'invalid_input', inferredCode: true, shape: 'transport' });
  }
  return { ...options, headers, idempotencyKey: key };
}

/** Whether a failed dispatched invocation could have committed without returning its run handle. */
export function isIndeterminateRunSubmission(error: unknown): error is JustCrawlError {
  return (error instanceof JustCrawlAbortError && error.dispatched)
    || error instanceof JustCrawlConnectionError || error instanceof JustCrawlTimeoutError
    || (error instanceof JustCrawlError && (error.submissionMayHaveCommitted === true
      || error.status >= 500 || (error.status >= 200 && error.status < 300)));
}

/** Validate the identity and summary needed by callers before releasing their recovery coordinate. */
export function hasUsableRunHandle(value: unknown, key: string, entryMode: 'api' | 'schedule_run_now'): boolean {
  if (!record(value) || !record(value.definitionSnapshot)) return false;
  const progress = ['admitted', 'succeeded', 'failed', 'queued', 'running', 'awaitingAcknowledgements'];
  return uuid(value.id) && value.submissionKey === key && value.entryMode === entryMode
    && typeof value.phase === 'string' && ['preparing', 'expanding', 'draining', 'terminal'].includes(value.phase)
    && nullableEnum(value.outcome, entryMode === 'api' ? ['completed', 'partial', 'failed'] : ['completed', 'partial', 'failed', 'skipped'])
    && typeof value.replayed === 'boolean' && typeof value.definitionSnapshot.name === 'string'
    && (value.initialCount === null || count(value.initialCount))
    && nullableEnum(value.lane, ['interactive', 'scheduled'])
    && (value.largeRun === null || typeof value.largeRun === 'boolean')
    && (value.warningThreshold === null || count(value.warningThreshold))
    && (value.scheduleId === null || uuid(value.scheduleId))
    && (value.scheduleName === null || typeof value.scheduleName === 'string')
    && nullableEnum(value.skipReason, ['overlap', 'workflow_unresolved'])
    && (value.blockingRunId === null || uuid(value.blockingRunId))
    && (value.blockingRunAgeSeconds === null || ageSeconds(value.blockingRunAgeSeconds))
    && (value.outcome === 'skipped'
      ? value.phase === 'terminal' && (value.skipReason === 'overlap'
        ? uuid(value.blockingRunId) && ageSeconds(value.blockingRunAgeSeconds)
        : value.skipReason === 'workflow_unresolved' && value.blockingRunId === null && value.blockingRunAgeSeconds === null)
      : value.skipReason === null && value.blockingRunId === null && value.blockingRunAgeSeconds === null)
    && hasCounters(value.seed, [...progress, 'visited'])
    && hasCounters(value.seed.buckets, ['admitted', 'input_duplicates', 'satisfied', 'credit_rejected',
      'limit_rejected', 'invalid_rejected', 'disabled_rejected', 'unroutable_rejected', 'ineligible_rejected', 'not_reached'])
    && hasCounters(value.descendant, [...progress, 'candidates', 'satisfied', 'junk', 'duplicates',
      'perExtractionTruncated', 'dayCapTruncated', 'creditRejected', 'limitRejected', 'targetRejected',
      'invalidRejected', 'notReached', 'errors']);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function uuid(value: unknown): boolean {
  return typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
}

function ageSeconds(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function hasCounters(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return record(value) && fields.every(field => count(value[field]));
}

function nullableEnum(value: unknown, values: readonly string[]): boolean {
  return value === null || (typeof value === 'string' && values.includes(value));
}
