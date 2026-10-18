import { JustCrawlError } from '../errors.js';
import type { BodyOf, ResultOf } from '../types.js';
import { Resource, type CallOptions } from './base.js';

/** Durable bounded uploads. Retain input ID and unchanged zero-based chunk ordinals. */
export class BatchInputsResource extends Resource {
  /** Create empty durable input metadata; no entries are returned by metadata reads. */
  create(options?: CallOptions): Promise<ResultOf<'/api/v1/batch-inputs', 'post'>> {
    return this.client.request('post', '/api/v1/batch-inputs', this.opts(options, { body: {} }));
  }

  /** Read bounded state and totals without materializing input URLs. */
  get(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/batch-inputs/{id}', 'get'>> {
    return this.client.request('get', '/api/v1/batch-inputs/{id}', this.opts(options, { path: { id } }));
  }

  /** Append at most 1,000 entries and 256 KiB of UTF-8, including the input/ordinal envelope. */
  async append(id: string, body: BodyOf<'/api/v1/batch-inputs/{id}/chunks', 'post'>, options?: CallOptions): Promise<ResultOf<'/api/v1/batch-inputs/{id}/chunks', 'post'>> {
    if (!Array.isArray(body.entries) || body.entries.length > 1000
      || !body.entries.every(entry => typeof entry === 'string')
      || !Number.isInteger(body.ordinal) || body.ordinal < 0 || body.ordinal > 2147483647
      || new TextEncoder().encode(JSON.stringify({ inputId: id, ordinal: body.ordinal, entries: body.entries })).byteLength > 256 * 1024) {
      throw new JustCrawlError({ message: 'Input chunk exceeds bounds or has invalid entries or ordinal', status: 0,
        code: 'invalid_input', inferredCode: true, shape: 'transport' });
    }
    return this.client.request('post', '/api/v1/batch-inputs/{id}/chunks', this.opts(options, { path: { id }, body }));
  }

  /** Seal only after contiguous receipts reconcile with submitted entry and chunk totals. */
  seal(id: string, body: BodyOf<'/api/v1/batch-inputs/{id}/seal', 'post'>, options?: CallOptions): Promise<ResultOf<'/api/v1/batch-inputs/{id}/seal', 'post'>> {
    return this.client.request('post', '/api/v1/batch-inputs/{id}/seal', this.opts(options, { path: { id }, body }));
  }
}
