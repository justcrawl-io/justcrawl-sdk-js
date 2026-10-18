/** The `Schedules` tag: automated recurring scraping. */

import type { BodyOf, QueryOf, ResultOf } from '../types.js';
import { BatchJobSubmissionIndeterminateError } from '../errors.js';
import { hasUsableRunHandle, isIndeterminateRunSubmission, normalizeRunSubmissionOptions,
  Resource, type CallOptions, type RunSubmissionOptions } from './base.js';

/** Per-trigger cancellation and a caller-owned invocation key for exact recovery. */
export type ScheduleTriggerOptions = RunSubmissionOptions;

export class SchedulesResource extends Resource {
  list(
    query?: QueryOf<'/api/v1/schedules', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/schedules', 'get'>> {
    return this.client.request('get', '/api/v1/schedules', this.opts(options, { query: this.q(query) }));
  }

  /**
   * Create a schedule. Count the matching tags with `batchJobs.count` first and
   * show the URL count and large-run warning before enabling recurring spend.
   * Runs spend credits, may take hours and have no customer cancellation.
   * Over-quota orgs get 402 with the standard quota payload.
   */
  create(
    body: BodyOf<'/api/v1/schedules', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/schedules', 'post'>> {
    return this.client.request('post', '/api/v1/schedules', this.opts(options, { body }));
  }

  /** New accepted/skipped run summaries and legacy rows with frozen counts, newest first. */
  listRuns(
    query?: QueryOf<'/api/v1/schedules/runs', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/schedules/runs', 'get'>> {
    return this.client.request('get', '/api/v1/schedules/runs', this.opts(options, { query: this.q(query) }));
  }

  get(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/schedules/{id}', 'get'>> {
    return this.client.request('get', '/api/v1/schedules/{id}', this.opts(options, { path: { id } }));
  }

  update(
    id: string,
    body: BodyOf<'/api/v1/schedules/{id}', 'put'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/schedules/{id}', 'put'>> {
    return this.client.request('put', '/api/v1/schedules/{id}', this.opts(options, { body, path: { id } }));
  }

  delete(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/schedules/{id}', 'delete'>> {
    return this.client.request('delete', '/api/v1/schedules/{id}', this.opts(options, { path: { id } }));
  }

  /** Pause or resume without losing the schedule's configuration or history. */
  toggle(
    id: string,
    body: BodyOf<'/api/v1/schedules/{id}/toggle', 'patch'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/schedules/{id}/toggle', 'patch'>> {
    return this.client.request(
      'patch',
      '/api/v1/schedules/{id}/toggle',
      this.opts(options, { body, path: { id } }),
    );
  }

  /**
   * Accept one immediate run without changing cadence, even for a disabled schedule.
   * Count first; this spends credits, may take hours and has no customer cancellation.
   * `maxJobs` caps admission. Preserve the key and intent through uncertainty and
   * recover with entryMode `schedule_run_now`. A skip consumes its key: after the
   * blocker settles, choose a new key for a deliberate new invocation.
   */
  async trigger(id: string, body?: BodyOf<'/api/v1/schedules/{id}/trigger', 'post'>,
    options?: ScheduleTriggerOptions): Promise<ResultOf<'/api/v1/schedules/{id}/trigger', 'post'>> {
    const normalized = normalizeRunSubmissionOptions(options);
    const intent = JSON.parse(JSON.stringify(body ?? {})) as typeof body;
    const source = { scheduleId: id };
    try {
      const result = await this.client.request('post', '/api/v1/schedules/{id}/trigger',
        this.opts(normalized, { path: { id }, body: intent }));
      if (!hasUsableRunHandle(result, normalized.idempotencyKey, 'schedule_run_now')) {
        throw new BatchJobSubmissionIndeterminateError(normalized.idempotencyKey, source);
      }
      return result;
    } catch (error) {
      if (error instanceof BatchJobSubmissionIndeterminateError) throw error;
      if (isIndeterminateRunSubmission(error)) {
        throw new BatchJobSubmissionIndeterminateError(normalized.idempotencyKey, source, error);
      }
      throw error;
    }
  }
}
