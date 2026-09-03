/**
 * The `BI` tag: the SQL console over the org's scraped data.
 *
 * **There is no run-a-saved-query endpoint, and this group does not invent one.**
 * To run a saved query: `getSavedQuery(id)` → read its `sql` → `runQuery({ sql })`.
 * Both calls are exposed so `@justcrawl/mcp-server`'s `jc_bi_run_saved` tool can
 * compose them; saved queries have no parameter model, so there is nothing to
 * bind. Note what this means for step 3: the MCP server's "no raw SQL" guarantee
 * is enforced at *its* tool boundary, not here — this SDK necessarily exposes
 * `runQuery`, because that is the only way to run anything at all.
 *
 * BI errors are the one part of the API that always emit the structured envelope
 * regardless of the `Accept` header, and BI carries its own code vocabulary
 * (`invalid_sql`, `feature_disabled`, `saved_query_name_taken`, …) on top of the
 * shared one. `errorFromResponse` passes those through verbatim with
 * `inferredCode: false` — they are real server codes, just not members of the
 * shared enum. The exception is a `401`, which shared middleware rejects before
 * any BI handler runs, so it arrives in the flat shape instead.
 */

import type { BodyOf, QueryOf, ResultOf } from '../types.js';
import { Resource, type CallOptions } from './base.js';

export class BiResource extends Resource {
  /** The queryable schema: tables and columns available to this org. */
  getSchema(options?: CallOptions): Promise<ResultOf<'/api/v1/bi/schema', 'get'>> {
    return this.client.request('get', '/api/v1/bi/schema', options);
  }

  /** Column detail for one table. */
  getTable(name: string, options?: CallOptions): Promise<ResultOf<'/api/v1/bi/tables/{name}', 'get'>> {
    return this.client.request('get', '/api/v1/bi/tables/{name}', this.opts(options, { path: { name } }));
  }

  /**
   * Submit a SQL query. Answers `429` (`too_many_queries`) when the org already
   * has too many in flight — a GET would be retried, but this POST is not.
   */
  runQuery(
    body: BodyOf<'/api/v1/bi/queries', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/queries', 'post'>> {
    return this.client.request('post', '/api/v1/bi/queries', this.opts(options, { body }));
  }

  /** Recent query runs. */
  listQueries(
    query?: QueryOf<'/api/v1/bi/queries', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/queries', 'get'>> {
    return this.client.request('get', '/api/v1/bi/queries', this.opts(options, { query: this.q(query) }));
  }

  /** One query run: status, timing, and error detail if it failed. */
  getQuery(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/bi/queries/{id}', 'get'>> {
    return this.client.request('get', '/api/v1/bi/queries/{id}', this.opts(options, { path: { id } }));
  }

  /** Row count, column list, and page count — cheaper than fetching page 1. */
  getResultManifest(
    id: string,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/queries/{id}/result-manifest', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/bi/queries/{id}/result-manifest',
      this.opts(options, { path: { id } }),
    );
  }

  /** One page of results. `pageSize` caps at 100 — pages, never a stream. */
  getResults(
    id: string,
    query?: QueryOf<'/api/v1/bi/queries/{id}/results', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/queries/{id}/results', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/bi/queries/{id}/results',
      this.opts(options, { query: this.q(query), path: { id } }),
    );
  }

  cancelQuery(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/bi/queries/{id}/cancel', 'post'>> {
    return this.client.request(
      'post',
      '/api/v1/bi/queries/{id}/cancel',
      this.opts(options, { path: { id } }),
    );
  }

  listSavedQueries(options?: CallOptions): Promise<ResultOf<'/api/v1/bi/saved-queries', 'get'>> {
    return this.client.request('get', '/api/v1/bi/saved-queries', options);
  }

  createSavedQuery(
    body: BodyOf<'/api/v1/bi/saved-queries', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/saved-queries', 'post'>> {
    return this.client.request('post', '/api/v1/bi/saved-queries', this.opts(options, { body }));
  }

  /** One saved query, including its `sql` — the first half of "run a saved query". */
  getSavedQuery(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/bi/saved-queries/{id}', 'get'>> {
    return this.client.request('get', '/api/v1/bi/saved-queries/{id}', this.opts(options, { path: { id } }));
  }

  updateSavedQuery(
    id: string,
    body: BodyOf<'/api/v1/bi/saved-queries/{id}', 'patch'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/saved-queries/{id}', 'patch'>> {
    return this.client.request(
      'patch',
      '/api/v1/bi/saved-queries/{id}',
      this.opts(options, { body, path: { id } }),
    );
  }

  deleteSavedQuery(
    id: string,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/saved-queries/{id}', 'delete'>> {
    return this.client.request(
      'delete',
      '/api/v1/bi/saved-queries/{id}',
      this.opts(options, { path: { id } }),
    );
  }

  /** Start an export of a completed query's results. */
  createExport(
    queryId: string,
    body: BodyOf<'/api/v1/bi/queries/{id}/exports', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/queries/{id}/exports', 'post'>> {
    return this.client.request(
      'post',
      '/api/v1/bi/queries/{id}/exports',
      this.opts(options, { body, path: { id: queryId } }),
    );
  }

  /** Export status and, once ready, its download pointer. */
  getExport(exportId: string, options?: CallOptions): Promise<ResultOf<'/api/v1/bi/exports/{exportId}', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/bi/exports/{exportId}',
      this.opts(options, { path: { exportId } }),
    );
  }
}
