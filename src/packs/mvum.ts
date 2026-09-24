/**
 * USFS Motor Vehicle Use Map roads + motorized trails for one cell (spec §2:
 * "is this forest road legal for my vehicle" detail OSM often lacks). Lines
 * are clipped to the cell locally; the derived `vehicleClass` is stamped on
 * every feature so the style can `match` on it.
 */

import { queryArcGisFeatures } from './arcgis.ts';
import { clipLineGeometry } from './clip.ts';
import type { LineGeometry } from './clip.ts';
import { throwIfAborted } from './http.ts';
import { mvumVehicleClass } from './mvumClass.ts';
import type { Bounds, PackContext, PackFeature, PackFeatureCollection } from './types.ts';

export const MVUM_SERVICE_URL = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer';
export const MVUM_LAYERS = [
  {
    id: 1,
    kind: 'road',
    outFields:
      'name,mvum_symbol_name,jurisdiction,operationalmaintlevel,surfacetype,system,seasonal,passengervehicle,highclearancevehicle,truck,atv,motorcycle,gis_miles',
  },
  {
    id: 2,
    kind: 'trail',
    outFields:
      'name,mvum_symbol_name,jurisdiction,trailclass,trailstatus,trailsystem,seasonal,passengervehicle,highclearancevehicle,truck,atv,motorcycle,gis_miles',
  },
] as const;

export async function fetchMvumPack(bounds: Bounds, ctx: PackContext = {}): Promise<PackFeatureCollection> {
  const [w, s, e, n] = bounds;
  const features: PackFeature[] = [];
  ctx.onProgress?.(0);
  for (let i = 0; i < MVUM_LAYERS.length; i++) {
    const layer = MVUM_LAYERS[i];
    throwIfAborted(ctx.signal);
    const raw = await queryArcGisFeatures(
      `${MVUM_SERVICE_URL}/${layer.id}`,
      {
        geometry: `${w},${s},${e},${n}`,
        geometryType: 'esriGeometryEnvelope',
        inSR: 4326,
        spatialRel: 'esriSpatialRelIntersects',
        outFields: layer.outFields,
        returnGeometry: true,
        outSR: 4326,
        geometryPrecision: 6,
      },
      { signal: ctx.signal, paginate: true, pageSize: 2000 }
    );
    for (const feature of raw) {
      const g = feature.geometry;
      if (g?.type !== 'LineString' && g?.type !== 'MultiLineString') continue;
      const clipped = clipLineGeometry(g as LineGeometry, bounds);
      if (!clipped) continue;
      const props = feature.properties ?? {};
      features.push({
        type: 'Feature',
        properties: { ...props, kind: layer.kind, vehicleClass: mvumVehicleClass(props) },
        geometry: clipped,
      });
    }
    ctx.onProgress?.((i + 1) / MVUM_LAYERS.length);
  }
  return { type: 'FeatureCollection', features };
}
