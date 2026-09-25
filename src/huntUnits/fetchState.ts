import { queryArcGisFeatures } from '../packs/arcgis.ts';
import { requestJson, type RequestOptions } from '../packs/http.ts';
import { boundsOf, normalizeSet, type UnitFeature } from './normalize.ts';
import type { HuntStateConfig } from './types.ts';

/** ~30 m; display-only simplification, same reasoning as the bundled Idaho layer. */
export const SIMPLIFY_DEGREES = 0.0003;

export interface SetResult {
  id: string;
  label: string;
  fetched: number;
  kept: number;
  /** The source layer's last-edited date (YYYY-MM-DD), when its service publishes one. */
  updated: string | null;
}

export interface StateResult {
  /** When the data was downloaded (ISO timestamp). */
  fetchedAt: string;
  features: UnitFeature[];
  bbox: [number, number, number, number];
  sets: SetResult[];
}

/**
 * The date a layer's data was last edited, from its service metadata (`editingInfo`). Hosted feature layers publish
 * it; older map servers don't (null). A failure here never fails the build — the date is informational.
 */
export async function layerLastEdited(
  layerUrl: string,
  options: Pick<RequestOptions, 'signal' | 'retries'> = {}
): Promise<string | null> {
  try {
    const info = await requestJson<any>(() => ({ url: `${layerUrl}?f=json` }), { ...options, retries: options.retries ?? 1 });
    const ms = info?.editingInfo?.lastEditDate ?? info?.editingInfo?.dataLastEditDate;
    return typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Downloads every set of a state from its agency's service and normalizes it into one feature list.
 * A set that returns nothing usable is an error: better to fail the build than publish an empty state.
 */
export async function fetchState(
  state: HuntStateConfig,
  options: Pick<RequestOptions, 'signal' | 'retries'> = {}
): Promise<StateResult> {
  const features: UnitFeature[] = [];
  const sets: SetResult[] = [];
  for (const set of state.sets) {
    const raw = await queryArcGisFeatures(
      set.layer,
      {
        where: set.where ?? '1=1',
        outFields: '*',
        returnGeometry: true,
        outSR: 4326,
        ...(state.fullResolution ? {} : { maxAllowableOffset: SIMPLIFY_DEGREES }),
        geometryPrecision: 5,
      },
      { ...options, paginate: set.paginate }
    );
    const kept = normalizeSet(set, raw);
    if (kept.length === 0) {
      throw new Error(`${state.code} ${set.id}: ${raw.length} features fetched but none usable (${set.layer})`);
    }
    features.push(...kept);
    sets.push({ id: set.id, label: set.label, fetched: raw.length, kept: kept.length, updated: await layerLastEdited(set.layer, options) });
  }
  return { fetchedAt: new Date().toISOString(), features, bbox: boundsOf(features), sets };
}
