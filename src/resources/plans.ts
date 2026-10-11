/** The `Plans` tag: billing, credits, and plan status. */

import type { BodyOf, QueryOf, ResultOf } from '../types.js';
import { Resource, type CallOptions } from './base.js';

export class PlansResource extends Resource {
  /**
   * Current plan and remaining credits.
   *
   * Worth calling before a large batch: the same numbers drive the `402`
   * quota gate, and a pre-flight check turns a mid-batch failure into a decision.
   */
  status(options?: CallOptions): Promise<ResultOf<'/api/v1/plans/status', 'get'>> {
    return this.client.request('get', '/api/v1/plans/status', options);
  }

  /** Credit ledger, newest first. */
  transactions(
    query?: QueryOf<'/api/v1/plans/transactions', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/plans/transactions', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/plans/transactions',
      this.opts(options, { query: this.q(query) }),
    );
  }

  /** Whether a recharge request is already pending. */
  rechargeRequestStatus(
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/plans/recharge-request/status', 'get'>> {
    return this.client.request('get', '/api/v1/plans/recharge-request/status', options);
  }

  /** Ask an administrator for more credits. Does not itself add any. */
  requestRecharge(
    body: BodyOf<'/api/v1/plans/recharge-request', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/plans/recharge-request', 'post'>> {
    return this.client.request('post', '/api/v1/plans/recharge-request', this.opts(options, { body }));
  }
}
