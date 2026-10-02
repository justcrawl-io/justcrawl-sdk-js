/** The `Workflows` tag: create, validate, publish, and version scraping workflows. */

import type { BodyOf, PathParamsOf, QueryOf, ResultOf } from '../types.js';
import { Resource, type CallOptions } from './base.js';

/**
 * A workflow has two uuids, and every method here that takes an `id` wants the
 * SECOND one:
 *
 * - `workflowId` — the stable logical id, constant across versions. This is what
 *   every method below takes, and what jobs and schedules reference.
 * - `id` — the primary key of the version row you happen to be holding. It
 *   changes on every edit and no endpoint accepts it.
 *
 * The trap is that the useless one is the one called `id`, so the obvious line
 * is the broken one:
 *
 * ```ts
 * const [wf] = await jc.workflows.list();
 * await jc.workflows.get(wf.id);         // 404 — version row key
 * await jc.workflows.get(wf.workflowId); // correct
 * ```
 *
 * Both fields carry the distinction in their generated JSDoc, so hovering the
 * property in an editor says which is which.
 */
export class WorkflowsResource extends Resource {
  /**
   * List workflows, optionally filtered by status or domain.
   *
   * Each item carries both `id` and `workflowId` — pass `workflowId` to every
   * other method on this class. See the class doc above.
   */
  list(
    query?: QueryOf<'/api/v1/workflows', 'get'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/workflows', 'get'>> {
    return this.client.request('get', '/api/v1/workflows', this.opts(options, { query: this.q(query) }));
  }

  /** Create a workflow. It starts unpublished — {@link publish} makes it routable. */
  create(
    body: BodyOf<'/api/v1/workflows', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/workflows', 'post'>> {
    return this.client.request('post', '/api/v1/workflows', this.opts(options, { body }));
  }

  /** Create a pre-wired smart workflow rather than assembling the DAG by hand. */
  createDefaultSmart(
    body: BodyOf<'/api/v1/workflows/create-default-smart', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/workflows/create-default-smart', 'post'>> {
    return this.client.request(
      'post',
      '/api/v1/workflows/create-default-smart',
      this.opts(options, { body }),
    );
  }

  /**
   * One workflow, latest version, with its DAG.
   *
   * @param id The workflow's stable logical id (`workflowId`), not a list item's `id`.
   */
  get(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/workflows/{id}', 'get'>> {
    return this.client.request('get', '/api/v1/workflows/{id}', this.opts(options, { path: { id } }));
  }

  update(
    id: string,
    body: BodyOf<'/api/v1/workflows/{id}', 'put'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/workflows/{id}', 'put'>> {
    return this.client.request('put', '/api/v1/workflows/{id}', this.opts(options, { body, path: { id } }));
  }

  /** Delete a workflow. Resolves to `undefined` — the API answers 204. */
  /**
   * Soft-delete a workflow.
   *
   * @param id The workflow's stable logical id (`workflowId`), not a list item's `id`.
   */
  delete(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/workflows/{id}', 'delete'>> {
    return this.client.request('delete', '/api/v1/workflows/{id}', this.opts(options, { path: { id } }));
  }

  /**
   * Clone a workflow as a new non-smart draft.
   *
   * @param id The workflow's stable logical id (`workflowId`), not a list item's `id`.
   */
  clone(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/workflows/{id}/clone', 'post'>> {
    return this.client.request('post', '/api/v1/workflows/{id}/clone', this.opts(options, { path: { id } }));
  }

  /**
   * Check the DAG against the 17 publish-time legality rules without publishing.
   *
   * Worth calling before {@link publish} in any automated pipeline: publish
   * enforces the same rules, but failing here costs nothing and names the rule.
   */
  validate(
    id: string,
    body: BodyOf<'/api/v1/workflows/{id}/validate', 'post'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/workflows/{id}/validate', 'post'>> {
    return this.client.request(
      'post',
      '/api/v1/workflows/{id}/validate',
      this.opts(options, { body, path: { id } }),
    );
  }

  /**
   * Make a workflow live. **Set its route first** — this is the one ordering
   * mistake the API cannot forgive.
   *
   * `create()` hands back a workflow already routed to `'*'`, the org-wide
   * default, and only one PUBLISHED workflow per org may hold a given route. So
   * the naive sequence works exactly once per org and then starts failing:
   *
   * ```ts
   * const wf = await jc.workflows.create({ name, dag });
   * await jc.workflows.publish(wf.workflowId);   // 409 from the 2nd workflow on
   * ```
   *
   * Give each workflow its own route before publishing:
   *
   * ```ts
   * await jc.workflows.setRouting(wf.workflowId, { route: 'domain:example.com' });
   * await jc.workflows.publish(wf.workflowId);
   * ```
   *
   * Throws `JustCrawlError` with `status: 409` when another published workflow
   * already holds the route, and `status: 400` when the DAG fails validation.
   */
  publish(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/workflows/{id}/publish', 'post'>> {
    return this.client.request(
      'post',
      '/api/v1/workflows/{id}/publish',
      this.opts(options, { path: { id } }),
    );
  }

  unpublish(id: string, options?: CallOptions): Promise<ResultOf<'/api/v1/workflows/{id}/unpublish', 'post'>> {
    return this.client.request(
      'post',
      '/api/v1/workflows/{id}/unpublish',
      this.opts(options, { path: { id } }),
    );
  }

  /** Replace the domain→workflow routing table for this workflow. */
  setRouting(
    id: string,
    body: BodyOf<'/api/v1/workflows/{id}/routing', 'put'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/workflows/{id}/routing', 'put'>> {
    return this.client.request(
      'put',
      '/api/v1/workflows/{id}/routing',
      this.opts(options, { body, path: { id } }),
    );
  }

  /**
   * Fetch one historical version — jobs pin the version they ran against.
   *
   * `version` is the spec's `number`, not the `number | string` this accepted
   * until the typed `request()` rejected the widening. The looser type promised
   * a call the API does not serve.
   */
  getVersion(
    id: PathParamsOf<'/api/v1/workflows/{id}/versions/{version}', 'get'>['id'],
    version: PathParamsOf<'/api/v1/workflows/{id}/versions/{version}', 'get'>['version'],
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/workflows/{id}/versions/{version}', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/workflows/{id}/versions/{version}',
      this.opts(options, { path: { id, version } }),
    );
  }
}
