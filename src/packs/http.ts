/**
 * The single network helper for the pack modules: fetch with the K-Maps
 * User-Agent, retry/backoff, abort support, plus form-POST (ArcGIS) and
 * Overpass helpers. Pure — only global `fetch`, `AbortController` and
 * `setTimeout`, so it runs in Hermes and in node.
 *
 * React Native's fetch cannot reliably set `User-Agent`; the header is sent
 * anyway and is simply ignored there.
 */

export const USER_AGENT = 'K-Maps/1.0 (offline outdoor maps app; github.com/einelson/k-maps)';

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Mutable so tests (and tools) can shorten the waits. */
export const httpSettings = {
  /** First retry waits this long, doubling each attempt (plus up to 25% jitter). */
  baseDelayMs: 1000,
  /** Overpass answers "too busy" with 504 for a while: back off harder and try more often than for ArcGIS. */
  overpassBaseDelayMs: 2000,
  overpassRetries: 6,
  maxDelayMs: 30_000,
  /** Pause between consecutive Overpass requests (be gentle with the shared servers). */
  overpassPauseMs: 1000,
  /** Per-attempt request timeout. */
  timeoutMs: 90_000,
};

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** Throw from a `validate` callback (or anywhere in a request) to have the request retried. */
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

export function abortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** Abortable sleep. Rejects with an AbortError as soon as `signal` fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let onAbort: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) {
      onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Retries after the first attempt. Default 4. */
  retries?: number;
  /** Overrides httpSettings.baseDelayMs for this request. */
  baseDelayMs?: number;
  timeoutMs?: number;
  /** Inspect the parsed JSON; throw RetryableError to retry, any other error to fail fast. */
  validate?: (json: any) => void;
  /** Called with each failed attempt's error (including ones about to be retried). */
  onAttemptError?: (err: unknown, attemptIndex: number) => void;
}

interface BuiltRequest {
  url: string;
  init?: RequestInit;
}

/** One attempt, with a timeout linked to the caller's abort signal. */
async function attempt(req: BuiltRequest, signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(req.url, {
      ...req.init,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(req.init?.headers as any) },
      signal: controller.signal,
    });
    if (!res.ok) {
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      const err = new HttpError(`HTTP ${res.status} from ${hostOf(req.url)}`, res.status);
      (err as any).retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
      throw err;
    }
    // Parse inside the timeout so a stalled body is also bounded.
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new RetryableError(`Non-JSON response from ${hostOf(req.url)}: ${text.slice(0, 80)}`);
    }
  } catch (err) {
    if (signal?.aborted) throw abortError();
    if (timedOut) throw new TimeoutError(`Timed out after ${timeoutMs} ms (${hostOf(req.url)})`);
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').split('/')[0];
}

// Matched by `name` rather than instanceof so it still works if a transpiler breaks Error subclassing.
function isRetryable(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'RetryableError' || name === 'TimeoutError') return true;
  if (name === 'HttpError') return RETRYABLE_STATUSES.has((err as HttpError).status);
  // fetch() rejects with a TypeError on network failure ("Network request failed" on RN).
  return name === 'TypeError';
}

/**
 * GET/POST -> parsed JSON with retries and exponential backoff on network
 * errors, timeouts, and 408/425/429/5xx. `build(attemptIndex)` is called for
 * every attempt so callers can rotate endpoints.
 */
export async function requestJson<T = any>(
  build: (attemptIndex: number) => BuiltRequest,
  options: RequestOptions = {}
): Promise<T> {
  const retries = options.retries ?? 4;
  const timeoutMs = options.timeoutMs ?? httpSettings.timeoutMs;
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    throwIfAborted(options.signal);
    try {
      const json = await attempt(build(i), options.signal, timeoutMs);
      options.validate?.(json);
      return json as T;
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err;
      options.onAttemptError?.(err, i);
      if (!isRetryable(err) || i === retries) throw err;
      const exp = Math.min(httpSettings.maxDelayMs, (options.baseDelayMs ?? httpSettings.baseDelayMs) * 2 ** i);
      const wait = Math.max((err as any).retryAfterMs ?? 0, exp) * (1 + Math.random() * 0.25);
      await sleep(Math.min(wait, httpSettings.maxDelayMs * 2), options.signal);
    }
  }
  throw lastError;
}

export function encodeForm(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** application/x-www-form-urlencoded POST returning JSON — what the ArcGIS REST `query` endpoints want. */
export function postForm<T = any>(
  url: string,
  params: Record<string, string | number | boolean | undefined>,
  options: RequestOptions = {}
): Promise<T> {
  const body = encodeForm(params);
  return requestJson<T>(
    () => ({
      url,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
    }),
    options
  );
}

let preferredOverpassEndpoint = 0;
/** Mirrors that timed out recently -> skipped until this time (ms since epoch), so one dead mirror costs one timeout, not one per query. */
const overpassPenaltyUntil = new Map<string, number>();
const OVERPASS_PENALTY_MS = 10 * 60_000;

/** Forget which mirror last worked and any timeout penalties (tests). */
export function resetOverpassEndpointPreference(): void {
  preferredOverpassEndpoint = 0;
  overpassPenaltyUntil.clear();
}

/**
 * Next mirror to try: the first one after `after` (or starting at the preferred one)
 * that hasn't timed out recently; if every mirror is sidelined, plain rotation.
 */
function nextOverpassEndpoint(after: number | null): number {
  const n = OVERPASS_ENDPOINTS.length;
  const now = Date.now();
  const start = after === null ? preferredOverpassEndpoint : after + 1;
  for (let k = 0; k < n; k++) {
    const idx = (start + k) % n;
    if ((overpassPenaltyUntil.get(OVERPASS_ENDPOINTS[idx]) ?? 0) <= now) return idx;
  }
  return start % n;
}

/**
 * Overpass QL query -> JSON. Rotates through OVERPASS_ENDPOINTS on failure
 * (sticking with whichever last worked, and sidelining a mirror that times
 * out), and treats a 200 whose `remark` reports a runtime error/timeout as a
 * retryable failure — Overpass answers those with partial data and HTTP 200.
 */
export function overpassQuery<T = { elements: any[] }>(
  query: string,
  options: RequestOptions = {}
): Promise<T> {
  const body = encodeForm({ data: query });
  let used = preferredOverpassEndpoint;
  return requestJson<T>(
    (i) => {
      used = nextOverpassEndpoint(i === 0 ? null : used);
      return {
        url: OVERPASS_ENDPOINTS[used],
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*' },
          body,
        },
      };
    },
    {
      // A dead mirror hangs until the timeout; a real sub-box query finishes in seconds.
      timeoutMs: 45_000,
      retries: httpSettings.overpassRetries,
      baseDelayMs: httpSettings.overpassBaseDelayMs,
      ...options,
      onAttemptError: (err, i) => {
        if ((err as { name?: string } | null)?.name === 'TimeoutError') {
          overpassPenaltyUntil.set(OVERPASS_ENDPOINTS[used], Date.now() + OVERPASS_PENALTY_MS);
        }
        options.onAttemptError?.(err, i);
      },
      validate: (json) => {
        if (!json || !Array.isArray(json.elements)) {
          throw new RetryableError('Overpass response had no elements array');
        }
        if (typeof json.remark === 'string' && /runtime error|timed out|out of memory/i.test(json.remark)) {
          throw new RetryableError(`Overpass: ${json.remark}`);
        }
        options.validate?.(json);
      },
    }
  ).then((json) => {
    preferredOverpassEndpoint = used;
    return json;
  });
}
