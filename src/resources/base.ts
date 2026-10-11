/**
 * Shared base for every resource group.
 *
 * A resource group is a thin, *typed* naming layer over `client.request()` — it
 * owns no transport behavior of its own. Auth, retries, timeouts, and error
 * mapping all live in `client.ts`, so there is exactly one place any of them can
 * be got wrong.
 *
 * One module per spec tag. `Authentication`, `Account`, and `Audit` deliberately
 * have no group, for two different reasons worth keeping apart. The auth
 * endpoints mint and refresh *JWTs* — a flow the dashboard and CLI own, and one
 * an `sr_live_…` caller never enters. Account deletion, GDPR export, and audit
 * logs are not like that: an API key reaches them exactly as it reaches jobs or
 * urls. They are ungrouped because they are deliberate, rarely-automated
 * operations that should not be fronted by a one-line typed helper — not
 * because a key cannot call them. Both remain reachable through
 * `client.request()`, typed against the spec like any other path.
 */

import type { JustCrawl, QueryParams, RequestOptions } from '../client.js';

export abstract class Resource {
  constructor(protected readonly client: JustCrawl) {}

  /**
   * Narrow a generated query-parameter object to the transport's loose
   * `QueryParams`.
   *
   * The generated types describe each endpoint's parameters precisely (literal
   * unions for enums, `number` for pages); `buildQueryString` accepts the general
   * shape. The two are structurally compatible but TypeScript will not infer the
   * widening across an index signature, so the cast happens once here rather than
   * ~99 times at the call sites — and stays visible as a single reviewable seam.
   */
  protected q(query: unknown): QueryParams | undefined {
    return query as QueryParams | undefined;
  }

  /**
   * Forward per-call options (`signal`, `timeoutMs`, `headers`) without repeating
   * the spread.
   *
   * Generic in `extra` on purpose. `request()`'s options type is now narrowed per
   * operation — `path` is required for a templated endpoint and `path?: never`
   * for a flat one — so a helper returning the loose `RequestOptions` would be
   * rejected at every one of the ~101 call sites. Preserving `extra`'s literal
   * type lets the narrowed shape survive the merge.
   */
  protected opts<T extends object>(options: CallOptions | undefined, extra: T): CallOptions & T {
    return { ...options, ...extra };
  }
}

/** Options every wrapper method accepts on top of its own arguments. */
export type CallOptions = Pick<RequestOptions, 'signal' | 'timeoutMs' | 'headers'>;
