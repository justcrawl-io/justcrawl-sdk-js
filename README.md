# @justcrawl/sdk

The official TypeScript client for the [JustCrawl](https://justcrawl.io) API — route
scraping requests across five providers with automatic fallback, structured
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
| `maxRetries` | `2` | Safe reads and replay-safe BI query submission — see below. |
| `fetch` | global `fetch` | Injectable, so tests never need a live API. |

## Resources

One group per API area:

`jobs` · `workflows` · `smartWorkflows` · `urls` · `schedules` · `extraction` ·
`analytics` · `benchmarks` · `plans` · `integrations` · `webhooks` · `bi`

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

## Retries

Retries are **safe-method-only by default**. Submitting a job twice charges twice,
so ordinary `POST`, `PATCH`, and `DELETE` calls are never retried.

`bi.runQuery()`, `bi.runStructuredQuery()`, and `bi.runSavedQuery()` are the
endpoint-specific write exceptions. Each creates an `Idempotency-Key` UUID for the invocation (or
preserves the caller's header) and reuses that key for
every retry. If the first response is lost after the query was accepted, the
gateway returns the original `jobId` without publishing a second query.

Keep your own UUID in the `Idempotency-Key` header when you need to recover
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

`requestId` comes from the `X-Request-ID` response header (which matches the
`request_id` in structured error bodies). Quote it in support requests.

## Results and expiry

`GET /jobs/{id}/result` returns **either** a presigned `resultUrl` (~15 minute
TTL) **or** a `blobKey`. `getResult()` resolves the presigned URL for you on a
bare, header-free fetch — your API key is never sent to the storage host.

Once a result passes your organization's retention window the API answers `410
Gone`; the SDK surfaces that as a typed outcome carrying `expiredAt` rather than
a generic error.

## License

Apache-2.0. Use of the JustCrawl API itself is governed by the
[JustCrawl terms](https://justcrawl.io/terms).
