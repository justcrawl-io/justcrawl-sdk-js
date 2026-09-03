/** The `Benchmarks` tag: provider benchmarking runs. */

import type { BodyOf, ResultOf } from '../types.js';
import { Resource, type CallOptions } from './base.js';

export class BenchmarksResource extends Resource {
  /**
   * Start a benchmark run.
   *
   * Benchmarks scrape for real, so this spends provider quota. It also `503`s
   * rather than charging when the platform credentials for a provider are unset.
   */
  create(
    body: BodyOf<'/api/v1/benchmarks', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/benchmarks', 'post'>> {
    return this.client.request('post', '/api/v1/benchmarks', this.opts(options, { body }));
  }

  /** The most recent completed benchmark for the org. */
  latest(options?: CallOptions): Promise<ResultOf<'/api/v1/benchmarks/latest', 'get'>> {
    return this.client.request('get', '/api/v1/benchmarks/latest', options);
  }

  get(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/benchmarks/{id}', 'get'>> {
    return this.client.request('get', '/api/v1/benchmarks/{id}', this.opts(options, { path: { id } }));
  }

  /** Stop a run in flight — the cheapest way to cap a benchmark's spend. */
  cancel(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/benchmarks/{id}/cancel', 'post'>> {
    return this.client.request(
      'post',
      '/api/v1/benchmarks/{id}/cancel',
      this.opts(options, { path: { id } }),
    );
  }

  results(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/benchmarks/{id}/results', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/benchmarks/{id}/results',
      this.opts(options, { path: { id } }),
    );
  }
}
