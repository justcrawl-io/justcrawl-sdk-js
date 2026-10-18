# @justcrawl/sdk

The official TypeScript client for the [JustCrawl](https://justcrawl.io) API — route
scraping requests across four supported providers with automatic fallback, structured
extraction, and warehouse delivery.

- **Zero runtime dependencies.** Node 20.3+ (uses the global `fetch`).
- **Fully typed** — request and response types are generated from the published
  OpenAPI spec, never hand-written, so they cannot drift from the API.
- **ESM and CommonJS**, with a single rolled-up `.d.ts`.

```bash
npm install @justcrawl/sdk
```

Version 0.2.0 adds structured BI queries, saving completed executions, saved-query
replay and SQL conversion. BI submission retries preserve one idempotency key,
and result pagination and CSV/Parquet exports retain their execution handles.

Version 0.2.1 includes the retired-provider error mapping and documentation for
manager-only API key and billing administration.

Version 0.3.0 adds BatchJob definitions, durable input uploads, count and start,
invocation recovery, and paginated run results and discovery history. Schedule
triggers return durable run handles and preserve replay keys and job limits.

## Quick start

```ts
import { JustCrawl } from '@justcrawl/sdk';

const jc = new JustCrawl({ apiKey: process.env.JUSTCRAWL_API_KEY! });

// Jobs run against a *URL item*, not a bare URL — register the target first.
const { id: urlItemId } = await jc.urls.create({ url: 'https://example.com/product/1' });

// Submit and wait for it to finish (polling, no streaming).
const job = await jc.jobs.submitAndWait({ urlItemId }, { maxWaitMs: 120_000 });

if (job.status === 'completed') {
  const result = await jc.jobs.fetchResult(job.id);
  if (result.kind === 'url') console.log(result.data);
}
```

Get an API key from **Settings → API Keys** in the dashboard. Keys look like
`sr_live_…`. Listing, creating and revoking keys requires `org:manage` (Owner
and Admin by default). Existing keys use their creator's current role grants.

`plans.status()` stays available to authenticated org members. Credit history,
recharge status and recharge submission require `org:manage`; missing permission
returns HTTP 403 through the SDK's existing error handling.

`workflowId` is optional on submit — omit it and the gateway resolves the
workflow from the URL's domain route.

## Client options

| Option | Default | Notes |
|---|---|---|
| `apiKey` | *(required)* | Sent as `Authorization: Bearer <key>`. Never appears in errors, logs, or serialized client state. |
| `baseUrl` |  `https://api.justcrawl.io` | Override for a self-hosted or staging deployment. |
| `timeoutMs` | `30000` | Per-request; surfaces a typed timeout error, not a raw `DOMException`. |
| `maxRetries` | `2` | Safe reads, BatchJob start, schedule trigger and replay-safe BI submission — see below. |
| `fetch` | global `fetch` | Injectable, so tests never need a live API. |

## Resources

One group per API area:

`jobs` · `workflows` · `smartWorkflows` · `urls` · `schedules` · `extraction` ·
`analytics` · `benchmarks` · `plans` · `integrations` · `webhooks` · `bi` ·
`batchJobs` · `batchInputs` · `batchJobRuns`

Anything without a hand-written wrapper — authentication, account, and audit-log
paths included — is reachable through the typed escape hatch:

```ts
const me = await jc.request('get', '/api/v1/auth/me');
const job = await jc.request('get', '/api/v1/jobs/{id}', { path: { id: jobId } });
```

The published Agent conversation subset is available through that typed escape
hatch. For example, a browser acting on a real user click can read the durable
card and post its stored action:

```ts
const state = await jc.request('get', '/api/v1/agents/{id}/cards', {
  path: { id: agentId },
});
const offer = state.cards.find(({ card }) => card.type === 'save_query_offer');

if (offer) {
  await jc.request('post', '/api/v1/agents/{id}/messages', {
    path: { id: agentId },
    body: { action: { cardId: offer.card.id, actionId: 'accept' } },
  });
}
```

That POST is not automatically retried and is not a way for a model to
self-confirm. The gateway reloads the tenant-owned card/action, creates the
durable click resolution, and the Agent save tool later accepts only that
current user turn. The cards response also contains id-only save receipts so a
deleted saved query does not make an old offer reusable.

`request()` is typed against the same generated spec types, so an unknown path,
a method the path does not define, or a missing path parameter is a compile
error rather than a runtime 404. Paths are the spec's own templates and values
go in `path` — an interpolated `` `/api/v1/jobs/${id}` `` is just a `string`,
and a `string` is checked against nothing.

For an endpoint published after your installed version was cut, opt out
explicitly:

```ts
const preview = await jc.requestUnchecked<{ ok: boolean }>('get', '/api/v1/preview/thing');
```

## BatchJob lifecycle

The SDK has 15 BatchJob methods, all typed from the public OpenAPI contract:

| Resource | Methods |
|---|---|
| `batchJobs` | `create`, `list`, `get`, `update`, `count`, `start` |
| `batchInputs` | `create`, `get`, `append`, `seal` |
| `batchJobRuns` | `list`, `get`, `jobs`, `results`, `discoveries` |

Upload and seal durable input, then count before launching:

```ts
const entries = ['https://example.com/product/1', 'https://example.com/product/2'];
const input = await jc.batchInputs.create();
const receipt = await jc.batchInputs.append(input.id, { ordinal: 0, entries });
console.log(receipt.acceptedCount, receipt.rejectedOrdinals);
await jc.batchInputs.seal(input.id, { chunkCount: 1, entryCount: entries.length });

const count = await jc.batchJobs.count({ inputId: input.id });
console.log(count.count, count.largeRun, count.warningThreshold);
// Show this count and obtain confirmation for a large run before continuing.

const submissionKey = crypto.randomUUID(); // persist before sending
const run = await jc.batchJobs.start(
  { source: { inputId: input.id, workflowId: null }, maxJobs: 100 },
  { idempotencyKey: submissionKey },
);
console.log(run.id, run.entryMode, run.submissionKey, run.phase);
```

`workflowId: null` uses Automatic routing; configure published routes before
launching. Start returns HTTP 202 with durable identity, `replayed` and the
current summary before jobs exist. It does not poll for completion. A sealed-input
quick start creates a hidden definition. Reusable definitions own their workflow,
input and discovery policy; start accepts `source: { definitionId }` without
overriding them. Definition saves return the saved definition and nonblocking
selector-overlap/inheritance warning codes.

Count accepts exactly one of `definitionId`, sealed `inputId` or `tags`. Encode
a tag array as `tags: JSON.stringify(tags)`; empty tags select every enabled URL.
Show `count` before starting and use the returned
`largeRun` and `warningThreshold` to confirm a large launch first. Unavailable or
forbidden counts do not mean zero. Work spends your organization's credits behind
quota checks and the refund policy, may take hours and has no customer
cancellation. There is no platform size cap; optional `maxJobs` is your chosen
positive safe-integer admission cap. Reaching it yields `max_jobs` and a partial
outcome. Later discovery may grow beyond the initial count.

REST/SDK chunks contain at most 1,000 entries and 256 KiB serialized UTF-8,
including the `inputId`, ordinal and entries envelope. Keep the input ID,
zero-based ordinals and exact chunk contents for replay. Receipts retain rejected
ordinals; rejected entries still count toward the submitted total when sealing.
Seal verifies contiguous chunks and declared totals. `batchInputs.get` returns
bounded metadata, not every URL. MCP appends have the tighter 100-entry limit.

Continue run pages without starting another run:

```ts
const first = await jc.batchJobRuns.jobs(run.id, { limit: 50 });
const next = first.pageInfo.nextCursor
  ? await jc.batchJobRuns.jobs(run.id, { limit: 50, cursor: first.pageInfo.nextCursor })
  : null;
```

Pages use `items`, `pageInfo: { nextCursor, hasMore }` and each entry's
`cursorAfter`; limits default to 50 and cap at 100. Keep filters unchanged while
continuing. A fresh traversal finds later results, descendants and discoveries;
existing cursors do not freeze mutable statuses or late commits. Preparing values
can be null, draining can include output, and seed/descendant counters remain
separate. Use phase/outcome to determine completion rather than an empty page.
Job references support workflows without extraction; result rows retain identity
and explicit availability or an oversized-data omission. Refund withholding
precedes expiry. Never forward an API key to a presigned storage URL.

## Recover an uncertain BatchJob start

```ts
import { BatchJobSubmissionIndeterminateError } from '@justcrawl/sdk';

try {
  await jc.batchJobs.start(intent, { idempotencyKey: submissionKey });
} catch (error) {
  if (!(error instanceof BatchJobSubmissionIndeterminateError)) throw error;
  const recovered = await jc.batchJobRuns.list({
    submissionKey: error.submissionKey,
    entryMode: error.entryMode,
  });
  console.log(recovered.items[0] ?? 'No acceptance committed; repeat the same intent with the same key.');
}
```

The error carries `submissionKey`, `entryMode: 'api'`,
`operation: 'batchJobs.start'`, `source` and `dispatched: true`. It preserves
recovery after network/timeout exhaustion, abort after send, exhausted possibly
accepted server failures, or success without a usable run handle. An abort before
send remains a `JustCrawlAbortError` with `dispatched: false`. Definitive
validation, conflict and quota responses retain normal typed errors when no
earlier attempt was ambiguous. After a lost response, timeout or possibly
accepted server failure, a later 401/403/402/conflict cannot erase that
uncertainty: the error retains its invocation key and final HTTP `cause`.
Restore authentication or permissions when needed, then recover that key.

Exact recovery accepts a 1–256-character key, including non-UUID strings, and
returns zero or one full run independently of recent history. Do not combine it
with a cursor, limit or other filters. **Zero matches means acceptance did not
commit: repeat the same intent with the same key.** Keep the key and normalized
intent before sending; changed intent under an accepted key conflicts. A new key
is for a deliberate new invocation. An abort does not cancel an accepted run.

BatchJob submission uses this SDK error; BI keeps its existing errors and the
MCP BI tools retain their own submission key for exact history recovery. The
in-site Agent Playground does not start BatchJobs yet.

## Schedule occurrences and manual triggers

Count matching tags before enabling recurring spend or triggering a large run,
show `count`, `largeRun` and `warningThreshold`, and obtain confirmation. Runs
spend credits, may take hours and have no customer cancellation.

```ts
const tagFilters = ['products'];
const count = await jc.batchJobs.count({ tags: JSON.stringify(tagFilters) });
console.log(count.count, count.largeRun, count.warningThreshold);
// Show the count and confirm large work before enabling.
const schedule = await jc.schedules.create({
  name: 'Product sweep', frequency: 'daily', tagFilters, workflowId: null,
  timezone: 'UTC', isEnabled: false,
});
const submissionKey = crypto.randomUUID(); // retain with the normalized intent
const run = await jc.schedules.trigger(schedule.id, { maxJobs: 500 }, { idempotencyKey: submissionKey });
const history = await jc.schedules.listRuns({ runId: run.id });
```

Trigger returns a flattened 202 run summary with `id`, `entryMode:
'schedule_run_now'`, `submissionKey` and `replayed`, before jobs exist. Its JSON
body accepts only optional `maxJobs`. A disabled schedule remains manually
triggerable, and run-now preserves its next cron occurrence. An accepted replay
returns the original current summary even after schedule edits or deletion.

An overlap or unresolved workflow returns a terminal `outcome: 'skipped'`, with
`skipReason: 'overlap'` or `'workflow_unresolved'`. Overlap retains
`blockingRunId` and `blockingRunAgeSeconds`. **A skip consumes its key:** retrying
that key replays the skip. After the blocker settles or routing is fixed, use a
new key for a deliberate new trigger. Changing `maxJobs` under a used key conflicts.

If no usable handle arrives, the same `BatchJobSubmissionIndeterminateError`
retains `operation: 'schedules.trigger'`, `entryMode: 'schedule_run_now'` and
`source: { scheduleId }`. Recover with
`jc.batchJobRuns.list({ submissionKey, entryMode: 'schedule_run_now' })` before
new work. Zero matches permits repeating the original intent and original key.
The reader also accepts `schedule_occurrence` for server-owned cron receipts;
keep the namespace with the key. Neither read chooses a trusted start mode.

`listRuns` merges new `kind: 'batch'` rows (run ID, phase/outcome, skip metadata
and current member counts) with `kind: 'legacy'` rows (frozen counts and no run
link), newest first. Accepted runs and jobs survive ordinary schedule deletion;
`scheduleId` becomes null while the run's frozen `scheduleName` remains. See the
[schedules guide](https://docs.justcrawl.io/guides/schedules/).

## Retries

Retries are **safe-method-only by default**. Submitting a job twice charges twice,
so ordinary `POST`, `PATCH`, and `DELETE` calls are never retried.

`batchJobs.start()`, `schedules.trigger()` and the BI methods `bi.runQuery()`,
`bi.runStructuredQuery()` and `bi.runSavedQuery()` are the endpoint-specific
write exceptions. BatchJob start and schedule trigger use a required 1–256-character key; BI uses a
UUID key. The SDK generates a UUID when omitted, preserves the caller's key and
reuses it for every retry. If the first response is lost after acceptance, the
gateway returns the original handle without accepting duplicate work.

For BI, keep your own UUID in the `Idempotency-Key` header when you need to recover
from a lost response after all SDK retries. Then use
`jc.bi.listQueries({ submissionKey })` to find the retained handle without
submitting again. This exact lookup is tenant-scoped and remains available
after newer queries fill recent history; a missing key returns an empty list.

Structured BI queries use the generated aggregate-definition contract rather
than SQL:

```ts
const query = await jc.bi.runStructuredQuery({
  definition: {
    version: 1,
    table: 'flat__shop__product',
    dimensions: [{ kind: 'time_bucket', column: 'captured_at', granularity: 'day' }],
    measures: [{ function: 'average', column: 'price' }],
    limit: 100,
  },
});

console.log(query.sqlPreview); // display only; never submit this text as input
```

Save a completed analysis by its execution handle. The API copies content,
scope, dialect, and provenance; clients never send scope fields or protected
SQL. Replay likewise sends only the saved id:

```ts
const saved = await jc.bi.createSavedQuery({
  name: 'Daily shop price',
  sourceQueryId: query.jobId,
});

const replay = await jc.bi.runSavedQuery(saved.id);
console.log(replay.jobId, replay.scopeKind, replay.sqlPreview);
```

Export a completed result without rerunning it. Keep the export handle and poll
it; each ready response carries a newly signed URL:

```ts
const { export: started } = await jc.bi.createExport(query.jobId, {
  format: 'parquet',
});
const { export: current } = await jc.bi.getExport(started.id);

if (current.status === 'ready' && current.downloadUrl) {
  const file = await fetch(current.downloadUrl); // no Authorization header
  await file.arrayBuffer();
}
```

Creation requires `bi:write`; polling requires `bi:read`. The API admits at
most 100,000 rows and 256 MiB of stored source JSONL by default, recovers queued
or expired work for a finite number of attempts, and retains both query and
export IDs in terminal failures. Never attach the JustCrawl API key when
fetching the storage URL. CSV exports neutralize formula-like headers and cells
with a leading apostrophe before CSV escaping; choose Parquet when values must
round-trip without that safety prefix. `bi.getResults()` also returns the
server-derived `exportEligibility` decision, including caller permission and
both admission-cap checks.

Saved-query discovery is cursor-paged. Continue with `nextCursor` while
`hasMore` is true:

```ts
const page = await jc.bi.listSavedQueries({ limit: 10 });
const next = page.nextCursor
  ? await jc.bi.listSavedQueries({ limit: 10, cursor: page.nextCursor })
  : null;
```

`convertSavedQueryToSql(saved.id)` returns an editable PostgreSQL rendering
without mutating the saved object. Persisting it with `updateSavedQuery` keeps
the saved scope and stamps the server-derived PostgreSQL dialect marker.

GETs retry on network errors, `5xx`, and `429`. A numeric `Retry-After` header is
honored when present; otherwise the client falls back to capped exponential
backoff with jitter. `402 Insufficient credits` is never retried.

## Errors

Every failure throws a `JustCrawlError` carrying `status`, `code`, `requestId`, and
the untouched `raw` body:

```ts
import { JustCrawlError } from '@justcrawl/sdk';

try {
  await jc.jobs.submit({ url, workflowId });
} catch (err) {
  if (err instanceof JustCrawlError) {
    console.error(err.code, err.status, err.requestId);
    if (err.code === 'quota_exceeded') console.error(err.remainingCredits);
  }
}
```

The API emits several error shapes. When the response does not carry a machine
code, the SDK infers one from the HTTP status and sets `inferredCode: true` — it
never invents a code and presents it as the server's.

A retired-only workflow submission keeps HTTP `422` and the API's legacy
`WORKFLOW_PROVIDER_RETIRED` token. The SDK maps that known token to
`code: 'provider_retired'`, with `inferredCode: false` and a fixed recovery
message. Choose a supported provider and publish a new workflow version before
submitting again; the refused submission spends no credits.

`requestId` comes from the `X-Request-ID` response header (which matches the
`request_id` in structured error bodies). Quote it in support requests.

## Results and expiry

`GET /jobs/{id}/result` returns **either** a presigned `resultUrl` (~15 minute
TTL) **or** a `blobKey`. `getResult()` resolves the presigned URL for you on a
bare, header-free fetch — your API key is never sent to the storage host.

Once a result passes your organization's retention window the API answers `410
Gone`; the SDK surfaces that as a typed outcome carrying `expiredAt` rather than
a generic error.

The complete BatchJob flow is in the [Batch jobs guide](https://docs.justcrawl.io/guides/batch-jobs/).

### Schedule and dataset definitions

Definition lists accept `kind: 'standard'`, `'schedule'` or `'dataset'`; omitting
it returns all visible kinds. A schedule definition also requires
`schedules:write` and verified email for updates. Dataset definitions accept
name-only updates: provisioning owns their workflow, exact version, selector
and discovery policy. Public starts by ID use the stored dataset version and
verify its live binding. A recurring dataset's schedule cannot be deleted until
the agent is stopped or changed. See the [binding guide](https://docs.justcrawl.io/guides/batch-jobs/#schedule-and-dataset-definitions).

## License

Apache-2.0. Use of the JustCrawl API itself is governed by the
[JustCrawl terms](https://justcrawl.io/terms).
