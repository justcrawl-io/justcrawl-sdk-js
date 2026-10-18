/**
 * The `BI` tag: the SQL console over the org's scraped data.
 *
 * Saved executions are resolved by the API: `runSavedQuery(id)` sends only the
 * saved id, so protected SQL, structured intent, and immutable scope never have
 * to be reconstructed by a client. The lower-level raw `runQuery` and
 * catalog-validated `runStructuredQuery` surfaces remain available for callers
 * that are creating new analyses.
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

type ResultManifestQuery = QueryOf<'/api/v1/bi/queries/{id}/result-manifest', 'get'>;
type ResultManifest = ResultOf<'/api/v1/bi/queries/{id}/result-manifest', 'get'>;
type SavedQueriesQuery = QueryOf<'/api/v1/bi/saved-queries', 'get'>;
type BiQueryBody = BodyOf<'/api/v1/bi/queries', 'post'>;
type BiSqlQueryBody = Extract<BiQueryBody, { sql: string }>;
type BiStructuredQueryBody = Extract<BiQueryBody, { definition: unknown }>;

function isCallOptions(value: unknown): value is CallOptions {
  return value !== null
    && typeof value === 'object'
    && ('signal' in value || 'timeoutMs' in value || 'headers' in value);
}

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
   * Submit a SQL query. The SDK adds an idempotency key and may safely retry
   * transport failures or retryable responses without submitting twice.
   */
  runQuery(
    body: BiSqlQueryBody,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/queries', 'post'>> {
    return this.#submitQuery(body, options);
  }

  /**
   * Submit a versioned aggregate definition. The response includes a
   * display-only `sqlPreview`; callers must never feed it back as input.
   */
  runStructuredQuery(
    body: BiStructuredQueryBody,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/queries', 'post'>> {
    return this.#submitQuery(body, options);
  }

  #submitQuery(
    body: BiQueryBody,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/queries', 'post'>> {
    const headers = { ...(options?.headers ?? {}) };
    let submissionKey: string | undefined;
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() !== 'idempotency-key') continue;
      submissionKey ??= value;
      delete headers[name];
    }
    submissionKey ??= globalThis.crypto.randomUUID();
    return this.client.request(
      'post',
      '/api/v1/bi/queries',
      this.opts(options, { body, headers, idempotencyKey: submissionKey }),
    );
  }

  /** Recent query runs, or an exact submissionKey lookup to recover a lost response. */
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
  getResultManifest(id: string, options?: CallOptions): Promise<ResultManifest>;
  getResultManifest(
    id: string,
    query: ResultManifestQuery | undefined,
    options?: CallOptions,
  ): Promise<ResultManifest>;
  getResultManifest(
    id: string,
    queryOrOptions?: ResultManifestQuery | CallOptions,
    options?: CallOptions,
  ): Promise<ResultManifest> {
    const usesLegacyOptions = options === undefined && isCallOptions(queryOrOptions);
    const query = usesLegacyOptions ? undefined : (queryOrOptions as ResultManifestQuery | undefined);
    const callOptions = usesLegacyOptions ? queryOrOptions : options;

    return this.client.request(
      'get',
      '/api/v1/bi/queries/{id}/result-manifest',
      this.opts(callOptions, { query: this.q(query), path: { id } }),
    );
  }

  /** One zero-based logical page of results. `pageSize` caps at 1,000. */
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

  /** List one cursor page of saved queries; pass `nextCursor` to continue. */
  listSavedQueries(options?: CallOptions): Promise<ResultOf<'/api/v1/bi/saved-queries', 'get'>>;
  listSavedQueries(
    query: SavedQueriesQuery | undefined,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/saved-queries', 'get'>>;
  listSavedQueries(
    queryOrOptions?: SavedQueriesQuery | CallOptions,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/saved-queries', 'get'>> {
    const usesLegacyOptions = options === undefined && isCallOptions(queryOrOptions);
    const query = usesLegacyOptions ? undefined : (queryOrOptions as SavedQueriesQuery | undefined);
    const callOptions = usesLegacyOptions ? queryOrOptions : options;

    return this.client.request(
      'get',
      '/api/v1/bi/saved-queries',
      this.opts(callOptions, { query: this.q(query) }),
    );
  }

  createSavedQuery(
    body: BodyOf<'/api/v1/bi/saved-queries', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/saved-queries', 'post'>> {
    return this.client.request('post', '/api/v1/bi/saved-queries', this.opts(options, { body }));
  }

  /** One saved query. Protected and structured rows deliberately return `sql: null`. */
  getSavedQuery(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/bi/saved-queries/{id}', 'get'>> {
    return this.client.request('get', '/api/v1/bi/saved-queries/{id}', this.opts(options, { path: { id } }));
  }

  /**
   * Run one saved query through the server-side resolver. The SDK adds an
   * idempotency key and may safely retry a lost submission response.
   */
  runSavedQuery(
    id: string,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/saved-queries/{id}/run', 'post'>> {
    const headers = { ...(options?.headers ?? {}) };
    let submissionKey: string | undefined;
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() !== 'idempotency-key') continue;
      submissionKey ??= value;
      delete headers[name];
    }
    submissionKey ??= globalThis.crypto.randomUUID();
    return this.client.request(
      'post',
      '/api/v1/bi/saved-queries/{id}/run',
      this.opts(options, { body: {}, headers, idempotencyKey: submissionKey, path: { id } }),
    );
  }

  /** Render a structured saved query as editable, PostgreSQL-pinned SQL. */
  convertSavedQueryToSql(
    id: string,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/bi/saved-queries/{id}/convert-to-sql', 'post'>> {
    return this.client.request(
      'post',
      '/api/v1/bi/saved-queries/{id}/convert-to-sql',
      this.opts(options, { path: { id } }),
    );
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
