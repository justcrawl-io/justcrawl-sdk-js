import type { QueryOf, ResultOf } from '../types.js';
import { Resource, type CallOptions } from './base.js';

/** Run history, exact invocation recovery and bounded partial-output reads. */
export class BatchJobRunsResource extends Resource {
  /**
   * List history, including accepted/skipped schedule occurrences, or recover
   * with only `submissionKey` and `entryMode` (`api`, `schedule_occurrence` or
   * `schedule_run_now`), without any other filters.
   */
  list(query?: QueryOf<'/api/v1/batch-job-runs', 'get'>, options?: CallOptions): Promise<ResultOf<'/api/v1/batch-job-runs', 'get'>> {
    return this.client.request('get', '/api/v1/batch-job-runs', this.opts(options, { query: this.q(query) }));
  }

  /** Read the server's summary; null preparation values mean unmeasured, not zero. */
  get(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/batch-job-runs/{id}', 'get'>> {
    return this.client.request('get', '/api/v1/batch-job-runs/{id}', this.opts(options, { path: { id } }));
  }

  /** Read seed/descendant jobs and raw-result references without fetching storage. */
  jobs(id: string, query?: QueryOf<'/api/v1/batch-job-runs/{id}/jobs', 'get'>, options?: CallOptions): Promise<ResultOf<'/api/v1/batch-job-runs/{id}/jobs', 'get'>> {
    return this.client.request('get', '/api/v1/batch-job-runs/{id}/jobs', this.opts(options, { path: { id }, query: this.q(query) }));
  }

  /** Read extracted rows and availability; a fresh traversal discovers later output. */
  results(id: string, query?: QueryOf<'/api/v1/batch-job-runs/{id}/results', 'get'>, options?: CallOptions): Promise<ResultOf<'/api/v1/batch-job-runs/{id}/results', 'get'>> {
    return this.client.request('get', '/api/v1/batch-job-runs/{id}/results', this.opts(options, { path: { id }, query: this.q(query) }));
  }

  /** Read actual parent/child observations and source/target pins, including rediscovery. */
  discoveries(id: string, query?: QueryOf<'/api/v1/batch-job-runs/{id}/discoveries', 'get'>, options?: CallOptions): Promise<ResultOf<'/api/v1/batch-job-runs/{id}/discoveries', 'get'>> {
    return this.client.request('get', '/api/v1/batch-job-runs/{id}/discoveries', this.opts(options, { path: { id }, query: this.q(query) }));
  }
}
