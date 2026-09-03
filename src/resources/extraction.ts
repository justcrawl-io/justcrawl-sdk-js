/** The `Extraction` tag: structured results, schemas, custom attributes, backfill. */

import type { BodyOf, PathParamsOf, QueryOf, ResultOf } from '../types.js';
import { Resource, type CallOptions } from './base.js';

export class ExtractionResource extends Resource {
  /** Recent extraction results across the org, optionally filtered by domain. */
  listResults(
    query?: QueryOf<'/api/v1/extraction/results', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/extraction/results', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/extraction/results',
      this.opts(options, { query: this.q(query) }),
    );
  }

  /**
   * The extraction result for one job.
   *
   * **A `202` here is not a result.** When the job is in `extraction_done` but
   * the bulk-writer has not flushed yet, the API answers `202` with an
   * `indexingPending` body and a `Retry-After: 5` header. `polling.ts` models
   * that as its own outcome; this method returns the body as the spec types it,
   * so check before treating it as an `ExtractionResult`.
   */
  getResultByJob(
    jobId: string,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/extraction/results/{jobId}', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/extraction/results/{jobId}',
      this.opts(options, { path: { jobId } }),
    );
  }

  /** One extraction result by its own id (not the job's). */
  getResultById(
    id: string,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/extraction/results/by-id/{id}', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/extraction/results/by-id/{id}',
      this.opts(options, { path: { id } }),
    );
  }

  /** The raw captured HTML behind an extraction result. */
  getRawResult(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/extraction/results/{id}/raw', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/extraction/results/{id}/raw',
      this.opts(options, { path: { id } }),
    );
  }

  /** Discovered XPath schemas, filterable by domain and page type. */
  listSchemas(
    query?: QueryOf<'/api/v1/extraction/schemas', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/extraction/schemas', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/extraction/schemas',
      this.opts(options, { query: this.q(query) }),
    );
  }

  /**
   * One domain's schema for a page type.
   *
   * `pageType` is the spec's own enum rather than a bare `string`, derived here
   * so it cannot drift: it was `string` until the typed `request()` refused it,
   * which meant a caller could ask for a page type the API has never had and
   * find out only from the 404.
   */
  getSchema(
    domain: PathParamsOf<'/api/v1/extraction/schemas/{domain}/{pageType}', 'get'>['domain'],
    pageType: PathParamsOf<'/api/v1/extraction/schemas/{domain}/{pageType}', 'get'>['pageType'],
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/extraction/schemas/{domain}/{pageType}', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/extraction/schemas/{domain}/{pageType}',
      this.opts(options, { path: { domain, pageType } }),
    );
  }

  /** Custom attributes configured for a domain. */
  getAttributes(
    domain: string,
    query?: QueryOf<'/api/v1/extraction/attributes/{domain}', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/extraction/attributes/{domain}', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/extraction/attributes/{domain}',
      this.opts(options, { query: this.q(query), path: { domain } }),
    );
  }

  /** Replace a domain's custom attributes wholesale. */
  setAttributes(
    domain: string,
    body: BodyOf<'/api/v1/extraction/attributes/{domain}', 'put'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/extraction/attributes/{domain}', 'put'>> {
    return this.client.request(
      'put',
      '/api/v1/extraction/attributes/{domain}',
      this.opts(options, { body, path: { domain } }),
    );
  }

  deleteAttributes(
    domain: string,
    query?: QueryOf<'/api/v1/extraction/attributes/{domain}', 'delete'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/extraction/attributes/{domain}', 'delete'>> {
    return this.client.request(
      'delete',
      '/api/v1/extraction/attributes/{domain}',
      this.opts(options, { query: this.q(query), path: { domain } }),
    );
  }

  /** Try an XPath against captured HTML without running a job. */
  testXPath(
    body: BodyOf<'/api/v1/extraction/test-xpath', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/extraction/test-xpath', 'post'>> {
    return this.client.request('post', '/api/v1/extraction/test-xpath', this.opts(options, { body }));
  }

  /**
   * Re-extract from already-captured HTML.
   *
   * Cheap relative to re-scraping — but bounded by blob retention: keys past the
   * org's `document_expiry_days` come back `blob_expired`, not re-fetched.
   */
  backfill(
    body: BodyOf<'/api/v1/extraction/backfill', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/extraction/backfill', 'post'>> {
    return this.client.request('post', '/api/v1/extraction/backfill', this.opts(options, { body }));
  }

  /** Extraction history for one URL item. */
  listByUrlItem(
    urlItemId: string,
    query?: QueryOf<'/api/v1/extraction/urls/{urlItemId}/extractions', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/extraction/urls/{urlItemId}/extractions', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/extraction/urls/{urlItemId}/extractions',
      this.opts(options, { query: this.q(query), path: { urlItemId } }),
    );
  }
}
