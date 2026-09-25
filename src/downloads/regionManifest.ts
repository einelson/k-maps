import { isAbortError, requestJson } from '../packs/http.ts';
import { parseRegionManifest, REGION_PACK_MANIFEST_URL, type RegionPackManifest } from '../packs/regionPacks.ts';

/**
 * Fetches the list of published region packs. Errors carry a message fit to show as-is: no connection,
 * nothing published yet, or a manifest this app version can't read.
 */
export async function fetchRegionManifest(
  signal?: AbortSignal,
  url: string = REGION_PACK_MANIFEST_URL
): Promise<RegionPackManifest> {
  let json: unknown;
  try {
    json = await requestJson(() => ({ url }), { signal, retries: 2, timeoutMs: 20_000 });
  } catch (err) {
    if (isAbortError(err)) throw err;
    if ((err as { status?: number } | null)?.status === 404) throw new Error('No region packs have been published yet');
    throw new Error(`Couldn't load the region pack list — check your connection (${(err as Error).message})`);
  }
  return parseRegionManifest(json);
}
