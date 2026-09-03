/** The `Smart Workflows` tag: auto-optimization mode and routing suggestions. */

import type { BodyOf, ResultOf } from '../types.js';
import { Resource, type CallOptions } from './base.js';

/**
 * Every `workflowId` here is a workflow's STABLE LOGICAL id — the `workflowId`
 * field of a workflow object, never its `id` (the version-row key, which 404s).
 * The parameter name matches the field name for exactly that reason; see
 * {@link WorkflowsResource} for the full explanation.
 *
 * Note that {@link listSuggestions} is the one method that does not 404 on a
 * wrong id — the endpoint returns an empty array for any workflow with no
 * suggestions, so an unrecognized id is indistinguishable from a quiet one.
 */
export class SmartWorkflowsResource extends Resource {
  /** Smart state for one workflow: current mode plus optimization telemetry. */
  get(
    workflowId: string,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/workflows/{workflowId}/smart', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/workflows/{workflowId}/smart',
      this.opts(options, { path: { workflowId } }),
    );
  }

  /** Switch the workflow between manual and auto-optimizing routing. */
  setMode(
    workflowId: string,
    body: BodyOf<'/api/v1/workflows/{workflowId}/smart/mode', 'put'>,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/workflows/{workflowId}/smart/mode', 'put'>> {
    return this.client.request(
      'put',
      '/api/v1/workflows/{workflowId}/smart/mode',
      this.opts(options, { body, path: { workflowId } }),
    );
  }

  /** Pending routing suggestions for one workflow. */
  /**
   * Every suggestion for one workflow, of every status, newest first.
   *
   * Returns `[]` rather than 404 when the workflow has no suggestions — and,
   * because the endpoint does not verify the id exists, also for an id that
   * matches nothing. An empty result is not evidence the id was right.
   */
  listSuggestions(
    workflowId: string,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/workflows/{workflowId}/smart/suggestions', 'get'>> {
    return this.client.request(
      'get',
      '/api/v1/workflows/{workflowId}/smart/suggestions',
      this.opts(options, { path: { workflowId } }),
    );
  }

  /** Apply a suggestion — this edits the workflow's routing. */
  applySuggestion(
    workflowId: string,
    suggestionId: string,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/workflows/{workflowId}/smart/suggestions/{id}/apply', 'post'>> {
    return this.client.request(
      'post',
      '/api/v1/workflows/{workflowId}/smart/suggestions/{id}/apply',
      this.opts(options, { path: { workflowId, id: suggestionId } }),
    );
  }

  dismissSuggestion(
    workflowId: string,
    suggestionId: string,
    options?: CallOptions,
  ): Promise<ResultOf<'/api/v1/workflows/{workflowId}/smart/suggestions/{id}/dismiss', 'post'>> {
    return this.client.request(
      'post',
      '/api/v1/workflows/{workflowId}/smart/suggestions/{id}/dismiss',
      this.opts(options, { path: { workflowId, id: suggestionId } }),
    );
  }

  /**
   * Suggestions across every workflow in the org.
   *
   * Lives on this group rather than `workflows` because the payload is the smart
   * suggestion shape, even though its path (`/api/v1/suggestions`) is not nested
   * under a workflow.
   */
  listAllSuggestions(options?: CallOptions): Promise<ResultOf<'/api/v1/suggestions', 'get'>> {
    return this.client.request('get', '/api/v1/suggestions', options);
  }
}
