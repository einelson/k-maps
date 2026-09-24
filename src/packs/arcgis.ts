/**
 * Paginated ArcGIS REST `query` helper (GeoJSON output) shared by the land
 * and MVUM packs. Handles the three ways these public services cap results:
 *
 *  - `paginate: true`  — layer supports `resultOffset` (FeatureServers, MVUM):
 *    page until a short page comes back.
 *  - default — layer does NOT support pagination (the USDOT PAD-US MapServer
 *    caps at 1000 with `exceededTransferLimit`): on truncation, fall back to
 *    `returnIdsOnly` and fetch the features by `objectIds` in small chunks.
 */

import type { Feature } from 'geojson';

import { postForm, RetryableError, throwIfAborted } from './http.ts';
import type { RequestOptions } from './http.ts';

export type ArcGisFeature = Feature<any, Record<string, any> | null>;

export interface ArcGisQueryOptions extends Pick<RequestOptions, 'signal' | 'retries'> {
  /** Layer supports resultOffset/resultRecordCount (+ orderByFields). */
  paginate?: boolean;
  /** Records per page / per objectIds chunk. */
  pageSize?: number;
  /** Called after each request completes. */
  onPage?: (featuresSoFar: number) => void;
}

const MAX_PAGES = 200;

function validateArcGis(json: any): void {
  const error = json?.error;
  if (!error) return;
  const message = `ArcGIS error ${error.code ?? ''}: ${error.message ?? JSON.stringify(error)}`;
  // 5xx-style errors in a 200 body are transient far more often than not.
  if (typeof error.code === 'number' && error.code >= 500) throw new RetryableError(message);
  throw new Error(message);
}

function isTruncated(json: any): boolean {
  return json?.exceededTransferLimit === true || json?.properties?.exceededTransferLimit === true;
}

/**
 * Runs `<layerUrl>/query` with `params` (f=geojson is added) and returns every
 * matching feature, however the service paginates.
 */
export async function queryArcGisFeatures(
  layerUrl: string,
  params: Record<string, string | number | boolean>,
  options: ArcGisQueryOptions = {}
): Promise<ArcGisFeature[]> {
  const { signal, retries, paginate = false, pageSize = 1000, onPage } = options;
  const url = `${layerUrl}/query`;
  const req = { signal, retries, validate: validateArcGis };

  if (paginate) {
    const all: ArcGisFeature[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      throwIfAborted(signal);
      const json = await postForm(
        url,
        {
          ...params,
          orderByFields: 'OBJECTID',
          resultOffset: all.length,
          resultRecordCount: pageSize,
          f: 'geojson',
        },
        req
      );
      const features: ArcGisFeature[] = json.features ?? [];
      for (const f of features) all.push(f);
      onPage?.(all.length);
      if (features.length === 0 || (!isTruncated(json) && features.length < pageSize)) break;
    }
    return all;
  }

  const first = await postForm(url, { ...params, f: 'geojson' }, req);
  const firstFeatures: ArcGisFeature[] = first.features ?? [];
  onPage?.(firstFeatures.length);
  if (!isTruncated(first)) return firstFeatures;

  // Truncated and the layer can't page: list every matching id, then fetch by id.
  const idsJson = await postForm(url, { ...params, returnIdsOnly: true, f: 'json' }, req);
  const ids: number[] = idsJson.objectIds ?? [];
  const all: ArcGisFeature[] = [];
  const chunk = Math.max(10, Math.min(pageSize, 100));
  const { geometry: _g, geometryType: _gt, inSR: _sr, spatialRel: _rel, ...rest } = params;
  for (let i = 0; i < ids.length; i += chunk) {
    throwIfAborted(signal);
    const json = await postForm(
      url,
      { ...rest, objectIds: ids.slice(i, i + chunk).join(','), f: 'geojson' },
      req
    );
    for (const f of json.features ?? []) all.push(f);
    onPage?.(all.length);
  }
  return all;
}
