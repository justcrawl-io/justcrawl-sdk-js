/**
 * The `Analytics` tag: performance metrics and reporting.
 *
 * Every endpoint here is a read over a rolling `hours` window and takes no path
 * parameters, so the group is uniformly thin.
 */

import type { QueryOf, ResultOf } from '../types.js';
import { Resource, type CallOptions } from './base.js';

export class AnalyticsResource extends Resource {
  /** Headline counters: jobs, success rate, spend. */
  overview(
    query?: QueryOf<'/api/v1/analytics/overview', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/analytics/overview', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/analytics/overview',
      this.opts(options, { query: this.q(query) }),
    );
  }

  /** Bucketed series over the window; `interval` picks the bucket width. */
  timeseries(
    query?: QueryOf<'/api/v1/analytics/timeseries', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/analytics/timeseries', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/analytics/timeseries',
      this.opts(options, { query: this.q(query) }),
    );
  }

  /** Per-provider success rate, latency, and cost. */
  providers(
    query?: QueryOf<'/api/v1/analytics/providers', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/analytics/providers', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/analytics/providers',
      this.opts(options, { query: this.q(query) }),
    );
  }

  /** Top domains by volume. */
  domains(
    query?: QueryOf<'/api/v1/analytics/domains', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/analytics/domains', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/analytics/domains',
      this.opts(options, { query: this.q(query) }),
    );
  }

  /** The domain × provider grid — which vendor actually works where. */
  matrix(
    query?: QueryOf<'/api/v1/analytics/matrix', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/analytics/matrix', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/analytics/matrix',
      this.opts(options, { query: this.q(query) }),
    );
  }
}
