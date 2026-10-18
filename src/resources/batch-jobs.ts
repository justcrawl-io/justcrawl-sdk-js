import { BatchJobSubmissionIndeterminateError } from '../errors.js';
import type { BodyOf, QueryOf, ResultOf } from '../types.js';
import { hasUsableRunHandle, isIndeterminateRunSubmission, normalizeRunSubmissionOptions,
  Resource, type CallOptions, type RunSubmissionOptions } from './base.js';

/** Per-invocation cancellation and a caller-owned recovery key. */
export type BatchJobStartOptions = RunSubmissionOptions;

/** Reusable BatchJob definitions, advisory sizing and durable run acceptance. */
export class BatchJobsResource extends Resource {
  /** Save a reusable definition; nonblocking warnings accompany the saved record. */
  create(body: BodyOf<'/api/v1/batch-jobs', 'post'>, options?: CallOptions): Promise<ResultOf<'/api/v1/batch-jobs', 'post'>> {
    return this.client.request('post', '/api/v1/batch-jobs', this.opts(options, { body }));
  }

  /** List standard, schedule or dataset definitions; preserve kind and other filters during continuation. */
  list(query?: QueryOf<'/api/v1/batch-jobs', 'get'>, options?: CallOptions): Promise<ResultOf<'/api/v1/batch-jobs', 'get'>> {
    return this.client.request('get', '/api/v1/batch-jobs', this.opts(options, { query: this.q(query) }));
  }

  /** Read one definition under the authenticated organization. */
  get(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/batch-jobs/{id}', 'get'>> {
    return this.client.request('get', '/api/v1/batch-jobs/{id}', this.opts(options, { path: { id } }));
  }

  /** Edit future invocations; datasets accept name only and schedules require schedule-write authority plus verified email. */
  update(id: string, body: BodyOf<'/api/v1/batch-jobs/{id}', 'patch'>, options?: CallOptions): Promise<ResultOf<'/api/v1/batch-jobs/{id}', 'patch'>> {
    return this.client.request('patch', '/api/v1/batch-jobs/{id}', this.opts(options, { path: { id }, body }));
  }

  /** Count before launch. Show `count` before proceeding when `largeRun` is true. */
  count(query: QueryOf<'/api/v1/batch-jobs/count', 'get'>, options?: CallOptions): Promise<ResultOf<'/api/v1/batch-jobs/count', 'get'>> {
    return this.client.request('get', '/api/v1/batch-jobs/count', this.opts(options, { query: this.q(query) }));
  }

  /**
   * Accept a run without polling. Count first: large crawls spend credits, may
   * take hours and cannot be cancelled. `maxJobs` is an optional caller cap.
   * Each deliberate call gets a new key unless the caller supplies one. After
   * an indeterminate response, recover by that key before launching new work.
   */
  async start(body: BodyOf<'/api/v1/batch-jobs/start', 'post'>, options?: BatchJobStartOptions): Promise<ResultOf<'/api/v1/batch-jobs/start', 'post'>> {
    const normalized = normalizeRunSubmissionOptions(options);
    // Freeze once so caller mutation cannot change a retry's fingerprint.
    const intent = JSON.parse(JSON.stringify(body)) as typeof body;
    try {
      const result = await this.client.request('post', '/api/v1/batch-jobs/start', this.opts(normalized, { body: intent }));
      if (!hasUsableRunHandle(result, normalized.idempotencyKey, 'api')) {
        throw new BatchJobSubmissionIndeterminateError(normalized.idempotencyKey, intent.source);
      }
      return result;
    } catch (error) {
      if (error instanceof BatchJobSubmissionIndeterminateError) throw error;
      if (isIndeterminateRunSubmission(error)) {
        throw new BatchJobSubmissionIndeterminateError(normalized.idempotencyKey, intent.source, error);
      }
      throw error;
    }
  }

}
