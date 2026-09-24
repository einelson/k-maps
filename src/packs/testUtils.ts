/** Shared helpers for the pack tests (not imported by app code). */
import { httpSettings } from './http.ts';

export type FetchCall = { url: string; method: string; body: string; params: URLSearchParams };

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

/** Replaces global fetch with a router; returns the recorded calls. Waits are shrunk to ~0. */
export function mockFetch(handler: (call: FetchCall, index: number) => unknown | Promise<unknown>) {
  httpSettings.baseDelayMs = 1;
  httpSettings.maxDelayMs = 2;
  httpSettings.overpassBaseDelayMs = 1;
  httpSettings.overpassPauseMs = 0;
  const calls: FetchCall[] = [];
  const fn = jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ?? '';
    const call: FetchCall = { url, method: init?.method ?? 'GET', body, params: new URLSearchParams(body) };
    calls.push(call);
    return handler(call, calls.length - 1);
  });
  (globalThis as any).fetch = fn;
  return { calls, fn };
}

export function square(cx: number, cy: number, half: number) {
  return {
    type: 'Polygon' as const,
    coordinates: [
      [
        [cx - half, cy - half],
        [cx + half, cy - half],
        [cx + half, cy + half],
        [cx - half, cy + half],
        [cx - half, cy - half],
      ],
    ],
  };
}
