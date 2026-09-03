/**
 * Submit-and-wait helpers (R7, R10).
 *
 * **Polling in chunks, never streaming.** The API exposes no long-poll, SSE, or
 * websocket surface for job progress, so the honest implementation is a backoff
 * loop over `GET /jobs/{id}`. Every wait here is cancellable and bounded.
 *
 * The result-fetch path carries the security-relevant rule in this file:
 * `GET /jobs/{id}/result` returns a **presigned** S3 URL, and that URL is
 * fetched on a bare, header-free request. Attaching `Authorization` would write
 * the customer's API key into S3's access logs — and S3 rejects a request that
 * carries both a presigned signature and an auth header anyway. This is why the
 * fetch below deliberately bypasses `client.request()`.
 */

import type { JustCrawl } from './client.js';
import {
  JustCrawlAbortError,
  JustCrawlConnectionError,
  JustCrawlError,
  JustCrawlTimeoutError,
} from './errors.js';
import { sleep } from './sleep.js';
import { isTerminalStatus, type Job, type JobStatus } from './types.js';

export interface PollOptions {
  /** Give up after this long. Defaults to 5 minutes. */
  maxWaitMs?: number;
  /** First gap between polls. Defaults to 1s, then backs off. */
  initialIntervalMs?: number;
  /** Ceiling on the gap between polls. Defaults to 15s. */
  maxIntervalMs?: number;
  /** Caller cancellation. Checked before every poll and during every wait. */
  signal?: AbortSignal;
  /** Called after each poll — useful for progress logging. */
  onPoll?: (job: Job, elapsedMs: number) => void;
  /**
   * Per-poll request timeout. Defaults to the client's.
   *
   * `submitAndWait` takes `PollOptions & CallOptions`, so a caller could always
   * PASS this — it just had nowhere to land, and every poll silently used the
   * client default instead.
   */
  timeoutMs?: number;
  /** Extra headers on each poll request. Same story as `timeoutMs`. */
  headers?: Record<string, string>;
}

const DEFAULTS = {
  maxWaitMs: 5 * 60_000,
  initialIntervalMs: 1_000,
  maxIntervalMs: 15_000,
};

/** Thrown when `maxWaitMs` elapses. Carries the last status actually seen. */
export class JobWaitTimeoutError extends JustCrawlError {
  readonly jobId: string;
  readonly lastStatus: JobStatus | undefined;
  readonly elapsedMs: number;

  constructor(jobId: string, lastStatus: JobStatus | undefined, elapsedMs: number) {
    super({
      // The last-seen status is the whole diagnostic value here: "still pending"
      // after two minutes means a queue backlog, while "running" means a slow
      // provider. A bare "timed out" would throw that distinction away.
      message: `Job ${jobId} did not reach a terminal status within ${elapsedMs}ms (last status: ${lastStatus ?? 'unknown'})`,
      status: 0,
      code: 'timeout',
      inferredCode: true,
      shape: 'transport',
    });
    this.name = 'JobWaitTimeoutError';
    this.jobId = jobId;
    this.lastStatus = lastStatus;
    this.elapsedMs = elapsedMs;
  }
}



/**
 * Poll a job until it reaches `completed` or `failed`.
 *
 * Backoff doubles from `initialIntervalMs` to `maxIntervalMs`, so a job that
 * takes minutes costs a handful of requests rather than one per second.
 *
 * @throws {JobWaitTimeoutError} when `maxWaitMs` elapses first.
 * @throws {JustCrawlAbortError} when the caller's signal fires.
 */
export async function waitForJob(client: JustCrawl, jobId: string, options: PollOptions = {}): Promise<Job> {
  const maxWaitMs = options.maxWaitMs ?? DEFAULTS.maxWaitMs;
  const maxIntervalMs = options.maxIntervalMs ?? DEFAULTS.maxIntervalMs;
  let interval = options.initialIntervalMs ?? DEFAULTS.initialIntervalMs;

  const startedAt = Date.now();
  let lastStatus: JobStatus | undefined;

  for (;;) {
    if (options.signal?.aborted === true) throw new JustCrawlAbortError();

    // Bound the whole poll — request AND the backoff between its retries — by
    // the remaining budget. A poll is a GET, so it carries the full retry
    // ladder: up to 3 attempts with a sleep between them, and that sleep can be
    // as long as a server-sent `Retry-After` (capped at maxDelayMs, 30s). A
    // per-request `timeoutMs` bounds each ATTEMPT and leaves those sleeps
    // unbounded, so it is not enough on its own — it caps the fetches while the
    // ladder still runs ~60s past the deadline. An AbortSignal is what reaches
    // both, because `send()` threads the caller's signal into its backoff sleep.
    let remaining = maxWaitMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new JobWaitTimeoutError(jobId, lastStatus, Date.now() - startedAt);

    const budget = AbortSignal.timeout(remaining);
    const pollSignal =
      options.signal === undefined ? budget : AbortSignal.any([options.signal, budget]);

    let job: Job;
    try {
      job = (await client.jobs.get(jobId, {
        signal: pollSignal,
        timeoutMs: Math.min(options.timeoutMs ?? client.timeoutMs, remaining),
        headers: options.headers,
      })) as Job;
    } catch (err) {
      // Who aborted decides what this means, and `budget` is the honest way to
      // ask. Re-reading `options.signal.aborted` here does not compile: the
      // loop-top check narrowed that property to `false | undefined`, and while
      // the narrowing is unsound (the flag flips during the await) TypeScript
      // still enforces it. `budget` carries no such narrowing.
      //
      // Caller cancelled -> their abort propagates untouched. Otherwise a failed
      // poll is a tick, not an outcome. One transient blip —
      // or the budget cutting a poll short near the deadline — must not surface
      // as a connection/timeout error from a method whose documented failure is
      // JobWaitTimeoutError. Fall through to the deadline check below: if time
      // remains, poll again; if not, report the timeout the contract promises.
      if (err instanceof JustCrawlAbortError && !budget.aborted) throw err;
      remaining = maxWaitMs - (Date.now() - startedAt);
      if (remaining <= 0) throw new JobWaitTimeoutError(jobId, lastStatus, Date.now() - startedAt);
      await sleep(Math.min(interval, remaining), options.signal);
      interval = Math.min(interval * 2, maxIntervalMs);
      continue;
    }

    const elapsedMs = Date.now() - startedAt;
    lastStatus = job.status as JobStatus | undefined;
    options.onPoll?.(job, elapsedMs);

    if (typeof job.status === 'string' && isTerminalStatus(job.status)) return job;

    // Re-check the budget *before* sleeping, so a wait that would overrun the
    // deadline is never entered — otherwise maxWaitMs is only an approximate
    // bound, overshooting by up to one full interval.
    remaining = maxWaitMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new JobWaitTimeoutError(jobId, lastStatus, Date.now() - startedAt);

    await sleep(Math.min(interval, remaining), options.signal);
    interval = Math.min(interval * 2, maxIntervalMs);
  }
}

/** Where a finished job's body actually lives. */
export type JobResultOutcome =
  | {
      /** Platform storage: the body was fetched from a presigned URL. */
      kind: 'url';
      data: string;
      providerId: string;
      statusCode: number;
      bodySize: number;
      latencyMs: number;
    }
  | {
      /**
       * Custom S3: the caller owns the bucket, so the SDK hands back the key
       * rather than pretending it can read it. Fetch it with your own creds.
       */
      kind: 'blob';
      blobKey: string;
      providerId: string;
      statusCode: number;
      bodySize: number;
      latencyMs: number;
    }
  | {
      /** The result existed but aged out of the org's retention window. */
      kind: 'expired';
      expiredAt?: string;
    };

interface ResultPointer {
  resultUrl?: string;
  blobKey?: string;
  providerId?: string;
  statusCode?: number;
  bodySize?: number;
  latencyMs?: number;
}

/**
 * Fetch a completed job's result, resolving the presigned URL when there is one.
 *
 * A `410 Gone` is returned as `{ kind: 'expired' }` rather than thrown: result
 * expiry is a normal outcome under a short retention policy, not an error the
 * caller did anything to cause. Every other failure still throws.
 *
 * @param fetchImpl Injectable fetch for the presigned URL. Defaults to the
 *   global — deliberately **not** the client's, so no client-level header
 *   configuration can ever leak onto the storage host.
 *
 * `timeoutMs` and `headers` apply to the **pointer request only**. The presigned
 * download is bounded by `timeoutMs` as well, but never receives `headers` —
 * see the fetch below for why that asymmetry is deliberate rather than an
 * oversight.
 */
export async function fetchJobResult(
  client: JustCrawl,
  jobId: string,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    headers?: Record<string, string>;
    fetchImpl?: typeof globalThis.fetch;
  } = {},
): Promise<JobResultOutcome> {
  let pointer: ResultPointer;
  try {
    pointer = (await client.jobs.getResultPointer(jobId, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      headers: options.headers,
    })) as ResultPointer;
  } catch (err) {
    if (err instanceof JustCrawlError && err.status === 410) {
      const raw = err.raw as { expiredAt?: string } | undefined;
      return { kind: 'expired', expiredAt: raw?.expiredAt };
    }
    throw err;
  }

  const meta = {
    providerId: pointer.providerId ?? '',
    statusCode: pointer.statusCode ?? 0,
    bodySize: pointer.bodySize ?? 0,
    latencyMs: pointer.latencyMs ?? 0,
  };

  if (typeof pointer.blobKey === 'string') {
    return { kind: 'blob', blobKey: pointer.blobKey, ...meta };
  }

  if (typeof pointer.resultUrl !== 'string') {
    throw new JustCrawlError({
      message: `Result for job ${jobId} carried neither resultUrl nor blobKey`,
      status: 0,
      code: 'internal_error',
      inferredCode: true,
      shape: 'transport',
      raw: pointer,
    });
  }

  // The bare fetch. No Authorization, no Accept, no client headers of any kind —
  // the presigned signature IS the credential, and adding ours would both leak
  // the API key to S3's logs and make S3 reject the request.
  //
  // `globalThis.fetch` is wrapped rather than passed by reference: calling it
  // detached from its receiver throws "Illegal invocation" in browsers and in
  // some runtimes that install fetch as a bound-method property. `client.ts`
  // already wraps it for exactly this reason.
  const doFetch = options.fetchImpl ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init));

  // This download is the ONE request in the SDK that does not go through
  // `client.request()`, so it inherits none of its protections. It needs its own
  // timeout: without one, a stalled S3 connection hangs forever, and
  // `submitAndWait` — which advertises a bounded `maxWaitMs` — would return only
  // when the process died. The caller's signal is composed with it so an
  // explicit cancellation still wins.
  const timeoutMs = options.timeoutMs ?? client.timeoutMs;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal =
    options.signal === undefined ? timeoutSignal : AbortSignal.any([options.signal, timeoutSignal]);

  // Both the request and the body read below can fail, and both must produce a
  // typed error — without this, a network-level failure escapes as a raw undici
  // `TypeError`, breaking this module's documented contract. Order matters: an
  // explicit caller abort is reported as an abort even though the timeout signal
  // is also part of the composed signal.
  const typedError = (err: unknown): JustCrawlError => {
    if (options.signal?.aborted === true) return new JustCrawlAbortError();
    if (timeoutSignal.aborted) return new JustCrawlTimeoutError(timeoutMs);
    return new JustCrawlConnectionError(err);
  };

  let response: Response;
  try {
    response = await doFetch(pointer.resultUrl, { signal });
  } catch (err) {
    throw typedError(err);
  }

  if (!response.ok) {
    throw new JustCrawlError({
      message: `Could not download the result body for job ${jobId} (HTTP ${response.status})`,
      status: response.status,
      code: response.status === 403 ? 'auth_forbidden' : 'internal_error',
      inferredCode: true,
      shape: 'transport',
    });
  }

  // Reading the body is a second chance to fail mid-stream — a result body can
  // be megabytes of HTML — so it gets the same typed-error treatment as the
  // request itself, and the same timeout (`signal` is still armed here).
  let data: string;
  try {
    data = await response.text();
  } catch (err) {
    throw typedError(err);
  }

  return { kind: 'url', data, ...meta };
}

/** The `202 indexingPending` body — a distinct outcome, never an ExtractionResult. */
export interface ExtractionIndexingPending {
  indexingPending: true;
  status: string;
  retryAfterSeconds: number;
  message?: string;
}

/** Whether an extraction response is the "still indexing" 202 rather than a result. */
export function isIndexingPending(value: unknown): value is ExtractionIndexingPending {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { indexingPending?: unknown }).indexingPending === true
  );
}

/**
 * Poll `GET /extraction/results/{jobId}` until the bulk-writer has flushed.
 *
 * The gateway answers `202` with `{ indexingPending: true, retryAfterSeconds }`
 * while a job sits in `extraction_done` — extraction finished, but the row is not
 * queryable yet. That is a *wait*, not a result and not an error, so this helper
 * respects the server's own `retryAfterSeconds` rather than imposing its own
 * backoff: the server knows its flush cadence.
 *
 * @throws {JobWaitTimeoutError} when `maxWaitMs` elapses while still pending.
 */
export async function waitForExtractionResult<T = unknown>(
  client: JustCrawl,
  jobId: string,
  options: PollOptions = {},
): Promise<T> {
  const maxWaitMs = options.maxWaitMs ?? DEFAULTS.maxWaitMs;
  const startedAt = Date.now();

  for (;;) {
    if (options.signal?.aborted === true) throw new JustCrawlAbortError();

    const body = await client.extraction.getResultByJob(jobId, { signal: options.signal });

    if (!isIndexingPending(body)) return body as T;

    const remaining = maxWaitMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new JobWaitTimeoutError(jobId, 'extraction_done', Date.now() - startedAt);

    // Clamp the server-supplied interval instead of trusting it. `isIndexingPending`
    // only checks the `indexingPending` flag, so `retryAfterSeconds` can be
    // absent, zero, negative, or non-numeric — and `undefined * 1000` is `NaN`,
    // which `setTimeout` coerces to 0. That turns a polite "check back in 5s"
    // into an unthrottled request-per-tick loop against the caller's own rate
    // limit for the full `maxWaitMs`. Deferring to the server's cadence is right;
    // deferring to a value the server may not have sent is not.
    const asked = Number(body.retryAfterSeconds);
    const serverAsked =
      Number.isFinite(asked) && asked > 0
        ? Math.min(asked * 1000, options.maxIntervalMs ?? DEFAULTS.maxIntervalMs)
        : (options.initialIntervalMs ?? DEFAULTS.initialIntervalMs);
    await sleep(Math.min(serverAsked, remaining), options.signal);
  }
}
