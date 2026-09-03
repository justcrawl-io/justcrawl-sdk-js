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
`sr_live_…`.

`workflowId` is optional on submit — omit it and the gateway resolves the
workflow from the URL's domain route.

## Client options

| Option | Default | Notes |
|---|---|---|
| `apiKey` | *(required)* | Sent as `Authorization: Bearer <key>`. Never appears in errors, logs, or serialized client state. |
| `baseUrl` |  `https://api.justcrawl.io` | Override for a self-hosted or staging deployment. |
| `timeoutMs` | `30000` | Per-request; surfaces a typed timeout error, not a raw `DOMException`. |
| `maxRetries` | `2` | GET requests only — see below. |
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

Retries are **GET-only**. The API has no idempotency-key support, and submitting a
job twice charges twice — so `POST`, `PATCH`, and `DELETE` are never retried.

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
