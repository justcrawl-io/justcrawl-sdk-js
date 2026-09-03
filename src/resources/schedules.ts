/** The `Schedules` tag: automated recurring scraping. */

import type { BodyOf, QueryOf, ResultOf } from '../types.js';
import { Resource, type CallOptions } from './base.js';

export class SchedulesResource extends Resource {
  list(
    query?: QueryOf<'/api/v1/schedules', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/schedules', 'get'>> {
    return this.client.request('get', '/api/v1/schedules', this.opts(options, { query: this.q(query) }));
  }

  /** Create a schedule. Over-quota orgs get 402 with the standard quota payload. */
  create(
    body: BodyOf<'/api/v1/schedules', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/schedules', 'post'>> {
    return this.client.request('post', '/api/v1/schedules', this.opts(options, { body }));
  }

  /** Past runs across schedules — the audit trail for "did my crawl fire?". */
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

  /** Run a schedule immediately, out of band. Consumes quota like any other run. */
  trigger(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/schedules/{id}/trigger', 'post'>> {
    return this.client.request(
      'post',
      '/api/v1/schedules/{id}/trigger',
      this.opts(options, { path: { id } }),
    );
  }
}
