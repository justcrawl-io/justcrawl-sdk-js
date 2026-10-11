/** The `Jobs` tag: submit and monitor scraping jobs. */

import { JustCrawlError } from '../errors.js';
import { fetchJobResult, waitForJob, type JobResultOutcome, type PollOptions } from '../polling.js';
import type { BodyOf, Job, QueryOf, ResultOf } from '../types.js';
import { Resource, type CallOptions } from './base.js';

export class JobsResource extends Resource {
  /**
   * Paginated list of jobs in the org.
   *
   * Heavy fields (`executionTrace`, `nodeState`) are stripped from list
   * responses — call {@link get} for those.
   */
  list(
    query?: QueryOf<'/api/v1/jobs', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/jobs', 'get'>> {
    return this.client.request('get', '/api/v1/jobs', this.opts(options, { query: this.q(query) }));
  }

  /**
   * Submit a scrape job. Returns `201` immediately with `status: pending`.
   *
   * **Never retried** — there is no idempotency key and a second submission
   * charges a second credit. The refund rule does not soften that: a crawl that
   * fails at every provider is free, but the refund lands on the job that
   * failed, never on a duplicate you submitted alongside it. Use
   * {@link JustCrawl.jobs.submitAndWait} to poll to completion.
   */
  submit(
    body: BodyOf<'/api/v1/jobs', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/jobs', 'post'>> {
    return this.client.request('post', '/api/v1/jobs', this.opts(options, { body }));
  }

  /** Status for many job ids in one call — cheaper than N polls. */
  batchStatus(
    body: BodyOf<'/api/v1/jobs/batch-status', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/jobs/batch-status', 'post'>> {
    return this.client.request('post', '/api/v1/jobs/batch-status', this.opts(options, { body }));
  }

  /** Aggregate counters over a rolling window. */
  stats(
    query?: QueryOf<'/api/v1/jobs/stats', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/jobs/stats', 'get'>> {
    return this.client.request('get', '/api/v1/jobs/stats', this.opts(options, { query: this.q(query) }));
  }

  /**
   * One job, including the heavy trace fields the list endpoint strips.
   *
   * A failed job says what happened to its credit: `creditOutcome` is `kept` or
   * `refunded` (a crawl that fails at every provider is free), and `creditNote`
   * is the API's own one-line reason — render it, don't re-word it.
   */
  get(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/jobs/{id}', 'get'>> {
    return this.client.request('get', '/api/v1/jobs/{id}', this.opts(options, { path: { id } }));
  }

  /**
   * The job's result pointer.
   *
   * Returns exactly one of `resultUrl` (presigned, ~15min TTL) or `blobKey`,
   * `410 Gone` once the org's retention window has passed, and `404` with
   * `reason: 'credit_refunded'` when no provider delivered a page (the credit
   * came back and nothing was stored). `polling.ts` wraps all three into typed
   * outcomes — prefer `jobs.fetchResult()` unless you want the raw pointer.
   */
  getResultPointer(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/jobs/{id}/result', 'get'>> {
    return this.client.request('get', '/api/v1/jobs/{id}/result', this.opts(options, { path: { id } }));
  }

  /**
   * Submit a job and poll until it reaches `completed` or `failed`.
   *
   * Polling in chunks, never streaming — the API has no long-poll surface.
   * Honors `signal` and `maxWaitMs`; the submit itself is a POST and so is never
   * retried, even if the first attempt times out.
   *
   * Note this resolves on `failed` too — a job that failed is a *result*, not an
   * exception. Check `job.status` rather than assuming success.
   *
   * @throws {JobWaitTimeoutError} when the job is still running at `maxWaitMs`.
   */
  async submitAndWait(
    body: BodyOf<'/api/v1/jobs', 'post'>,
    options: PollOptions & CallOptions = {},
  ): Promise<Job> {
    // No cast. `submit` is already typed through the generated spec, where the
    // 201 body declares `jobId: string` as required and declares no `id` at all
    // — so the previous `as { jobId?: string; id?: string }` widened a required
    // field to optional and invented a fallback that could never fire. Casting
    // here also defeated the generated-type discipline the whole package (and
    // the verify-sdk-types gate) exists to enforce, in the method most likely to
    // be copied as the template for the next one.
    const submitted = await this.submit(body, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      headers: options.headers,
    });

    const { jobId } = submitted;
    if (typeof jobId !== 'string') {
      // Kept as a runtime guard despite the type saying it cannot happen: the
      // type describes the spec's promise, not what a proxy or a future gateway
      // version actually sent. A typed error beats `undefined` reaching the
      // polling loop and 404ing on every attempt.
      throw new JustCrawlError({
        message: 'Job submission succeeded but the response carried no job id',
        status: 0,
        code: 'internal_error',
        inferredCode: true,
        shape: 'transport',
        raw: submitted,
      });
    }

    return waitForJob(this.client, jobId, options);
  }

  /**
   * Fetch a finished job's body, resolving the presigned URL when there is one.
   *
   * Returns a discriminated outcome rather than a bare string: platform storage
   * yields `kind: 'url'` with the body, custom S3 yields `kind: 'blob'` with the
   * key for you to fetch with your own credentials, an aged-out result yields
   * `kind: 'expired'`, and a job no provider delivered a page for yields
   * `kind: 'refunded'` — none of the last two throw, because none of them is a
   * fault on the caller's side.
   *
   * **Your API key is never sent to the storage host** — the presigned URL is
   * fetched header-free.
   */
  fetchResult(id: string, options?: CallOptions): Promise<JobResultOutcome> {
    // All three CallOptions fields are forwarded. Accepting `CallOptions` and
    // then passing only `signal` meant a caller-set `timeoutMs` was silently
    // ignored on the one call path that fetches a potentially multi-megabyte
    // body — the place a custom timeout is most likely to be wanted.
    return fetchJobResult(this.client, id, {
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
      headers: options?.headers,
    });
  }
}
