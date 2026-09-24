import {
  encodeForm,
  httpSettings,
  isAbortError,
  OVERPASS_ENDPOINTS,
  overpassQuery,
  postForm,
  requestJson,
  resetOverpassEndpointPreference,
  USER_AGENT,
} from './http.ts';
import { jsonResponse, mockFetch } from './testUtils.ts';

beforeEach(() => {
  resetOverpassEndpointPreference();
  httpSettings.timeoutMs = 90_000;
});

describe('http', () => {
  it('encodes form params, skipping undefined', () => {
    expect(encodeForm({ a: 'x y', b: 2, c: undefined, d: true })).toBe('a=x%20y&b=2&d=true');
  });

  it('sends the K-Maps User-Agent and a form-encoded POST', async () => {
    const { fn } = mockFetch(() => jsonResponse({ ok: 1 }));
    const json = await postForm('https://example.test/query', { where: "a='b'", f: 'geojson' });
    expect(json).toEqual({ ok: 1 });
    const [url, init] = fn.mock.calls[0] as [string, any];
    expect(url).toBe('https://example.test/query');
    expect(init.method).toBe('POST');
    expect(init.headers['User-Agent']).toBe(USER_AGENT);
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(init.body).toBe("where=a%3D'b'&f=geojson");
  });

  it('retries 503 and network errors with backoff, then succeeds', async () => {
    const { calls } = mockFetch((_c, i) => {
      if (i === 0) return jsonResponse('busy', 503);
      if (i === 1) throw new TypeError('Network request failed');
      return jsonResponse({ done: true });
    });
    await expect(postForm('https://example.test/q', {})).resolves.toEqual({ done: true });
    expect(calls).toHaveLength(3);
  });

  it('does not retry a 400', async () => {
    const { calls } = mockFetch(() => jsonResponse('bad', 400));
    await expect(postForm('https://example.test/q', {})).rejects.toThrow('HTTP 400');
    expect(calls).toHaveLength(1);
  });

  it('gives up after the retry budget', async () => {
    const { calls } = mockFetch(() => jsonResponse('busy', 502));
    await expect(requestJson(() => ({ url: 'https://example.test/q' }), { retries: 2 })).rejects.toThrow('HTTP 502');
    expect(calls).toHaveLength(3);
  });

  it('treats a non-JSON 200 as retryable', async () => {
    const { calls } = mockFetch((_c, i) => (i === 0 ? jsonResponse('<html>oops</html>') : jsonResponse({ ok: 1 })));
    await expect(postForm('https://example.test/q', {})).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it('aborts immediately and during backoff', async () => {
    const controller = new AbortController();
    mockFetch(() => {
      controller.abort();
      return jsonResponse('busy', 503);
    });
    httpSettings.baseDelayMs = 10_000;
    httpSettings.maxDelayMs = 10_000;
    const err = await postForm('https://example.test/q', {}, { signal: controller.signal }).catch((e) => e);
    expect(isAbortError(err)).toBe(true);

    const already = new AbortController();
    already.abort();
    const { calls } = mockFetch(() => jsonResponse({}));
    await expect(postForm('https://example.test/q', {}, { signal: already.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(calls).toHaveLength(0);
  });

  it('times out a stalled request and retries', async () => {
    let n = 0;
    (globalThis as any).fetch = jest.fn((_url: string, init: { signal: AbortSignal }) => {
      n++;
      if (n === 1) {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
        });
      }
      return Promise.resolve(jsonResponse({ ok: 1 }));
    });
    httpSettings.baseDelayMs = 1;
    httpSettings.maxDelayMs = 2;
    await expect(postForm('https://example.test/q', {}, { timeoutMs: 20 })).resolves.toEqual({ ok: 1 });
    expect(n).toBe(2);
  });
});

describe('overpassQuery', () => {
  const okBody = { elements: [{ type: 'node', id: 1 }] };

  it('rotates endpoints on failure and on runtime-error remarks', async () => {
    const { calls } = mockFetch((_c, i) => {
      if (i === 0) return jsonResponse('gateway', 504);
      if (i === 1) return jsonResponse({ elements: [], remark: 'runtime error: Query timed out in "query" at line 1' });
      return jsonResponse(okBody);
    });
    const json = await overpassQuery('[out:json];node(1);out;');
    expect(json).toEqual(okBody);
    expect(calls.map((c) => c.url)).toEqual(OVERPASS_ENDPOINTS);
    expect(calls[0].params.get('data')).toBe('[out:json];node(1);out;');
  });

  it('sticks with the endpoint that last worked', async () => {
    mockFetch((_c, i) => (i === 0 ? jsonResponse('busy', 503) : jsonResponse(okBody)));
    await overpassQuery('q');
    const { calls } = mockFetch(() => jsonResponse(okBody));
    await overpassQuery('q');
    expect(calls[0].url).toBe(OVERPASS_ENDPOINTS[1]);
  });

  it('sidelines a mirror that timed out so later queries skip it', async () => {
    const seen: string[] = [];
    (globalThis as any).fetch = jest.fn((url: string, init: { signal: AbortSignal }) => {
      seen.push(url);
      if (url === OVERPASS_ENDPOINTS[0]) {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return Promise.resolve(jsonResponse(okBody));
    });
    httpSettings.baseDelayMs = 1;
    httpSettings.overpassBaseDelayMs = 1;
    httpSettings.maxDelayMs = 2;
    await overpassQuery('q1', { timeoutMs: 20 });
    await overpassQuery('q2', { timeoutMs: 20 });
    // q1: primary times out, second mirror answers. q2: starts from that mirror; the dead primary is not retried.
    expect(seen).toEqual([OVERPASS_ENDPOINTS[0], OVERPASS_ENDPOINTS[1], OVERPASS_ENDPOINTS[1]]);
  });

  it('rejects a response without an elements array', async () => {
    mockFetch(() => jsonResponse({ foo: 1 }));
    await expect(overpassQuery('q', { retries: 1 })).rejects.toThrow('no elements');
  });
});
