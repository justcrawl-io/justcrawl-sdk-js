/**
 * The one cancellable sleep in this package.
 *
 * Extracted because `client.ts`'s retry backoff and `polling.ts`'s inter-poll
 * gap had byte-identical copies of it under two names. The subtleties here are
 * easy to get subtly different on a later edit — checking `aborted` up front
 * (an already-aborted signal never fires `abort` again, so a listener alone
 * would hang), removing the listener on the resolve path so a long-lived signal
 * does not accumulate them, and rejecting rather than resolving on abort so a
 * caller cannot mistake "cancelled" for "waited".
 */

import { JustCrawlAbortError } from './errors.js';

/**
 * Sleep for `ms`, settling early — and rejecting — if `signal` aborts.
 *
 * @param ms      How long to sleep.
 * @param signal  Optional cancellation. Rejects with {@link JustCrawlAbortError}.
 */
export function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new JustCrawlAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new JustCrawlAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
