import { useCallback, useEffect, useState } from 'react';

import { isAbortError } from '../packs/http';
import type { RegionPackManifest } from '../packs/regionPacks';
import { fetchRegionManifest } from './regionManifest';

export type ManifestState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: RegionPackManifest }
  | { status: 'error'; message: string };

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Fetches the published pack list once per mount; the Downloads sections (region packs, hunting units) share it. */
export function useRegionManifest(): { manifest: ManifestState; retry: () => void } {
  const [manifest, setManifest] = useState<ManifestState>({ status: 'loading' });

  const load = useCallback((signal?: AbortSignal) => {
    fetchRegionManifest(signal)
      .then((loaded) => setManifest({ status: 'ready', manifest: loaded }))
      .catch((err) => {
        if (!isAbortError(err)) setManifest({ status: 'error', message: errorMessage(err) });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const retry = useCallback(() => {
    setManifest({ status: 'loading' });
    load();
  }, [load]);

  return { manifest, retry };
}
