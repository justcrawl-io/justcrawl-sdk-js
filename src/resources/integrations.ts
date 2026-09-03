/**
 * The `Integrations` tag: SQS inputs, S3/webhook outputs, and storage config.
 *
 * Inputs and outputs are near-symmetric CRUD surfaces, so the method names
 * deliberately mirror each other (`listInputs`/`listOutputs`, …) rather than
 * collapsing into one generic method — a mistyped "kind" argument would silently
 * reconfigure the wrong side of a customer's pipeline.
 */

import type { BodyOf, ResultOf } from '../types.js';
import { Resource, type CallOptions } from './base.js';

export class IntegrationsResource extends Resource {
  listInputs(options?: CallOptions): Promise<ResultOf<'/api/v1/integrations/inputs', 'get'>> {
    return this.client.request('get', '/api/v1/integrations/inputs', options);
  }

  createInput(
    body: BodyOf<'/api/v1/integrations/inputs', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/integrations/inputs', 'post'>> {
    return this.client.request('post', '/api/v1/integrations/inputs', this.opts(options, { body }));
  }

  updateInput(
    id: string,
    body: BodyOf<'/api/v1/integrations/inputs/{id}', 'put'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/integrations/inputs/{id}', 'put'>> {
    return this.client.request(
      'put',
      '/api/v1/integrations/inputs/{id}',
      this.opts(options, { body, path: { id } }),
    );
  }

  deleteInput(
    id: string,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/integrations/inputs/{id}', 'delete'>> {
    return this.client.request(
      'delete',
      '/api/v1/integrations/inputs/{id}',
      this.opts(options, { path: { id } }),
    );
  }

  toggleInput(
    id: string,
    body: BodyOf<'/api/v1/integrations/inputs/{id}/toggle', 'patch'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/integrations/inputs/{id}/toggle', 'patch'>> {
    return this.client.request(
      'patch',
      '/api/v1/integrations/inputs/{id}/toggle',
      this.opts(options, { body, path: { id } }),
    );
  }

  listOutputs(options?: CallOptions): Promise<ResultOf<'/api/v1/integrations/outputs', 'get'>> {
    return this.client.request('get', '/api/v1/integrations/outputs', options);
  }

  createOutput(
    body: BodyOf<'/api/v1/integrations/outputs', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/integrations/outputs', 'post'>> {
    return this.client.request('post', '/api/v1/integrations/outputs', this.opts(options, { body }));
  }

  /** Platform-managed outputs — readable, not editable by the customer. */
  listInternalOutputs(options?: CallOptions): Promise<ResultOf<'/api/v1/integrations/outputs/internal', 'get'>> {
    return this.client.request('get', '/api/v1/integrations/outputs/internal', options);
  }

  updateOutput(
    id: string,
    body: BodyOf<'/api/v1/integrations/outputs/{id}', 'put'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/integrations/outputs/{id}', 'put'>> {
    return this.client.request(
      'put',
      '/api/v1/integrations/outputs/{id}',
      this.opts(options, { body, path: { id } }),
    );
  }

  deleteOutput(
    id: string,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/integrations/outputs/{id}', 'delete'>> {
    return this.client.request(
      'delete',
      '/api/v1/integrations/outputs/{id}',
      this.opts(options, { path: { id } }),
    );
  }

  toggleOutput(
    id: string,
    body: BodyOf<'/api/v1/integrations/outputs/{id}/toggle', 'patch'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/integrations/outputs/{id}/toggle', 'patch'>> {
    return this.client.request(
      'patch',
      '/api/v1/integrations/outputs/{id}/toggle',
      this.opts(options, { body, path: { id } }),
    );
  }

  /** The org's blob storage configuration (bucket, prefix, retention). */
  getStorage(options?: CallOptions): Promise<ResultOf<'/api/v1/integrations/storage', 'get'>> {
    return this.client.request('get', '/api/v1/integrations/storage', options);
  }

  setStorage(
    body: BodyOf<'/api/v1/integrations/storage', 'put'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/integrations/storage', 'put'>> {
    return this.client.request('put', '/api/v1/integrations/storage', this.opts(options, { body }));
  }
}
