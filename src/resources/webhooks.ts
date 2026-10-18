/**
 * The `Webhooks` tag: the public URL ingestion endpoint.
 *
 * One operation, and it is unlike every other endpoint in this SDK: it
 * authenticates with a **path token**, not the org's API key. The `Authorization`
 * header still rides along (the transport always sends it) and the gateway
 * ignores it here — but that means a caller must not assume the token is secret
 * because the key is: the token in the URL is the credential.
 */

import type { BodyOf, ResultOf } from '../types.js';
import { Resource, type CallOptions } from './base.js';

export class WebhooksResource extends Resource {
  /**
   * Push URLs into the org's ingestion pipeline.
   *
   * Subject to a daily URL cap, which answers `429` with a flat message body —
   * and, today, **no `Retry-After` header**. A retry is safe here only in the
   * sense that ingestion dedupes; the SDK still does not retry it, because it is
   * a POST.
   */
  ingest(
    token: string,
    body: BodyOf<'/api/v1/webhooks/{token}/ingest', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/webhooks/{token}/ingest', 'post'>> {
    return this.client.request(
      'post',
      '/api/v1/webhooks/{token}/ingest',
      this.opts(options, { body, path: { token } }),
    );
  }
}
