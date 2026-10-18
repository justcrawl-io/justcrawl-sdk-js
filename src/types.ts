/**
 * Type plumbing over the generated spec types (R6).
 *
 * Every request and response shape in this SDK is *derived* from
 * `src/generated/api.d.ts` through the aliases below — none is re-declared by
 * hand. That is the whole point: a hand-written interface would be a second
 * source of truth that `verify-sdk-types` cannot gate, and it would drift from
 * the API the first time a field changed.
 *
 * **A3 shapes all of this.** The committed spec carries zero `operationId`
 * values, so `openapi-typescript` emits `operations` as `Record<string, never>`
 * — an empty map with nothing to reference. Every type below therefore indexes
 * through `paths[path][method]` instead, which is why the aliases are needed at
 * all: written inline at each call site, that indexing is unreadable.
 */

import type { components, paths } from './generated/api.js';

/** Every path the published spec documents. */
export type ApiPath = keyof paths;

/** HTTP methods that can appear on a path item. */
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * The methods actually defined on `P`.
 *
 * `openapi-typescript` emits absent methods as `never`, not as missing keys, so
 * a plain `keyof paths[P]` would offer every verb on every path. Filtering on
 * `never` is what makes `client.request('put', '/api/v1/jobs')` a compile error.
 */
export type MethodOf<P extends ApiPath> = {
  [M in HttpMethod]: M extends keyof paths[P] ? (paths[P][M] extends undefined ? never : M) : never;
}[HttpMethod];

/** The operation object for one path+method pair. */
export type Operation<P extends ApiPath, M extends MethodOf<P>> = paths[P][M & keyof paths[P]];

/** Unwrap `{ content: { 'application/json': B } }` to `B`. */
type JsonBody<T> = T extends { content: { 'application/json': infer B } } ? B : never;

/**
 * The success body for an operation.
 *
 * A union over the 2xx codes the operation declares, because several endpoints
 * legitimately answer with more than one — `POST /extraction/backfill` returns
 * `202`, the five wrapped DELETEs return `204` (modeled as `undefined`, which is
 * exactly what the transport resolves for an empty body).
 */
export type SuccessBody<O> =
  | (O extends { responses: { 200: infer R } } ? JsonBody<R> : never)
  | (O extends { responses: { 201: infer R } } ? JsonBody<R> : never)
  | (O extends { responses: { 202: infer R } } ? JsonBody<R> : never)
  | (O extends { responses: { 204: unknown } } ? undefined : never);

/** The success body for a path+method pair. */
export type ResultOf<P extends ApiPath, M extends MethodOf<P>> = SuccessBody<Operation<P, M>>;

/** The JSON request body a path+method pair accepts, or `never` when it takes none. */
export type BodyOf<P extends ApiPath, M extends MethodOf<P>> =
  Operation<P, M> extends { requestBody?: infer RB } ? JsonBody<NonNullable<RB>> : never;

/** The query parameters a path+method pair accepts, or `never` when it takes none. */
export type QueryOf<P extends ApiPath, M extends MethodOf<P>> =
  Operation<P, M> extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never;

/**
 * The path parameters a path+method pair declares, or `never` when it has none.
 *
 * This is what lets `client.request()` take the spec's own template —
 * `'/api/v1/jobs/{id}'` — rather than a pre-interpolated string. A template is a
 * member of the `ApiPath` union and so is checked against the spec; an
 * interpolated `` `/api/v1/jobs/${id}` `` is just `string` and is checked
 * against nothing. `openapi-typescript` emits absent path params as
 * `path?: never`, which `NonNullable` collapses back to `never` — so
 * "has params" is a decidable question at the type level, and `TypedRequestOptions`
 * uses it to make `path` required exactly when the endpoint needs it.
 */
export type PathParamsOf<P extends ApiPath, M extends MethodOf<P>> =
  Operation<P, M> extends { parameters: { path?: infer PP } } ? NonNullable<PP> : never;

type SchemaMap = components['schemas'];

/** Names of every schema in `components.schemas`. */
export type SchemaName = keyof SchemaMap;

/** A named schema from the spec's `components.schemas`. */
export type Schema<N extends SchemaName> = SchemaMap[N];

/** A scrape job, exactly as the spec defines it. */
export type Job = SchemaMap['Job'];

/**
 * Job lifecycle statuses, split terminal vs not.
 *
 * The polling helpers key off these, so they live here next to the generated
 * `Job` type rather than in `polling.ts` — if the spec's status enum grows a
 * value, the mismatch surfaces as a type error at the assertion below instead of
 * as a poll loop that never terminates.
 */
export const TERMINAL_JOB_STATUSES = ['completed', 'failed'] as const;
export const NON_TERMINAL_JOB_STATUSES = [
  'pending',
  'running',
  'waiting_retry',
  'extracting',
  'extraction_done',
] as const;

export type TerminalJobStatus = (typeof TERMINAL_JOB_STATUSES)[number];
export type NonTerminalJobStatus = (typeof NON_TERMINAL_JOB_STATUSES)[number];
export type JobStatus = TerminalJobStatus | NonTerminalJobStatus;

/**
 * Compile-time proof that the two lists above exactly partition the spec's own
 * status enum. If the API adds a status and the types are regenerated, this line
 * stops compiling — which is the point: a new status silently defaulting to
 * "keep polling" would hang `submitAndWait` forever.
 */
type SpecJobStatus = NonNullable<Job['status']>;
type _StatusPartitionIsExhaustive = [SpecJobStatus] extends [JobStatus]
  ? [JobStatus] extends [SpecJobStatus]
    ? true
    : { error: 'SDK declares a job status the spec does not have'; extra: Exclude<JobStatus, SpecJobStatus> }
  : { error: 'spec has a job status the SDK does not classify'; missing: Exclude<SpecJobStatus, JobStatus> };
const _statusPartitionCheck: _StatusPartitionIsExhaustive = true;
void _statusPartitionCheck;

/** Whether a status means the job will not change again. */
export function isTerminalStatus(status: string): status is TerminalJobStatus {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}
