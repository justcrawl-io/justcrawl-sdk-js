/** The `URLs` tag: manage the scraping targets jobs run against. */

import type { BodyOf, QueryOf, ResultOf } from '../types.js';
import { Resource, type CallOptions } from './base.js';

export class UrlsResource extends Resource {
  /** Paginated, filterable list of URL items. `pageSize` caps at 100. */
  list(query?: QueryOf<'/api/v1/urls', 'get'>, options?: CallOptions): Promise<ResultOf<'/api/v1/urls', 'get'>> {
    return this.client.request('get', '/api/v1/urls', this.opts(options, { query: this.q(query) }));
  }

  create(body: BodyOf<'/api/v1/urls', 'post'>, options?: CallOptions): Promise<ResultOf<'/api/v1/urls', 'post'>> {
    return this.client.request('post', '/api/v1/urls', this.opts(options, { body }));
  }

  /** Create many URL items in one request — far cheaper than N calls. */
  createBatch(
    body: BodyOf<'/api/v1/urls/batch', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/urls/batch', 'post'>> {
    return this.client.request('post', '/api/v1/urls/batch', this.opts(options, { body }));
  }

  /**
   * Delete many URL items in one request.
   *
   * Note this is a `DELETE` **with a body** — unusual, but it is what the API
   * defines, and the transport sends it. Like every write, it is never retried.
   */
  deleteBatch(
    body: BodyOf<'/api/v1/urls/batch', 'delete'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/urls/batch', 'delete'>> {
    return this.client.request('delete', '/api/v1/urls/batch', this.opts(options, { body }));
  }

  get(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/urls/{id}', 'get'>> {
    return this.client.request('get', '/api/v1/urls/{id}', this.opts(options, { path: { id } }));
  }

  update(
    id: string,
    body: BodyOf<'/api/v1/urls/{id}', 'patch'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/urls/{id}', 'patch'>> {
    return this.client.request('patch', '/api/v1/urls/{id}', this.opts(options, { body, path: { id } }));
  }

  delete(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/urls/{id}', 'delete'>> {
    return this.client.request('delete', '/api/v1/urls/{id}', this.opts(options, { path: { id } }));
  }

  /** Enable or disable a URL item without deleting it. */
  toggle(
    id: string,
    body: BodyOf<'/api/v1/urls/{id}/toggle', 'patch'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/urls/{id}/toggle', 'patch'>> {
    return this.client.request(
      'patch',
      '/api/v1/urls/{id}/toggle',
      this.opts(options, { body, path: { id } }),
    );
  }

  /** Jobs run against this URL item. */
  listJobs(
    id: string,
    query?: QueryOf<'/api/v1/urls/{id}/jobs', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/urls/{id}/jobs', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/urls/{id}/jobs',
      this.opts(options, { query: this.q(query), path: { id } }),
    );
  }

  /** Extraction results for this URL item, newest first. */
  listExtractions(
    id: string,
    query?: QueryOf<'/api/v1/urls/{id}/extractions', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/urls/{id}/extractions', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/urls/{id}/extractions',
      this.opts(options, { query: this.q(query), path: { id } }),
    );
  }
}
