import { useEffect, useState } from 'react';
import { GeoJSONSource, Layer, type PressEventWithFeatures } from '@maplibre/maplibre-react-native';
import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec';
import { useSQLiteContext } from 'expo-sqlite';
import type { FeatureCollection } from 'geojson';

import { listCoverage } from '../downloads/coverageRepo';
import { isCellBundled } from '../packs/region';
import { packCellUri } from '../packs/packStorage';
import { PACK_LAYER_IDS, type PackLayerId } from '../packs/types';
import { usePackStore } from '../state/usePackStore';
import { TEXT_FONT } from './glyphs';
import { LAND_FILL_COLOR_EXPRESSION, PUB_ACCESS_COLORS } from './landSource';
import { MVUM_COLOR_EXPRESSION } from './mvumSource';
import { OSM_CASING_WIDTH, OSM_LINE_COLOR, OSM_LINE_WIDTH } from './osmSource';
import { POI_CATEGORY_META, type PoiCategory } from './poiSources';
import { TRAIL_COLOR_EXPRESSION } from './trailsSource';

/** Color of the "likely private (inferred)" tint (§6.4). */
export const LIKELY_PRIVATE_COLOR = '#7c3aed';

/** Bundled starter data is a GeoJSON object; a downloaded cell is a `file://` URI MapLibre loads natively. */
export type PackData = FeatureCollection | string;

type PressHandler = (event: {
  nativeEvent: PressEventWithFeatures;
  stopPropagation?: () => void;
}) => void;

const f = (expression: unknown) => expression as FilterSpecification;
const kindIs = (kind: string) => f(['==', ['get', 'kind'], kind]);

/**
 * Empty anchor layers that pin the stacking order of overlay groups (§5.1).
 * Downloaded cells mount long after the map first renders, and a layer added
 * late would otherwise land on top of everything (including your own pins).
 * Each group is inserted just under its anchor, so the stack stays
 * online rasters < land < OSM roads < MVUM < USFS trails < hunt units < hazards (fire, radar) <
 * POI pins < your data, however cells arrive. Key order is mount order is stacking order.
 */
export const PACK_ANCHORS = {
  raster: 'anchor-raster',
  land: 'anchor-land',
  osm: 'anchor-osm',
  mvum: 'anchor-mvum',
  trails: 'anchor-trails',
  hunt: 'anchor-hunt',
  hazard: 'anchor-hazard',
  poi: 'anchor-poi',
} as const;

export function PackAnchors() {
  return (
    <>
      {Object.values(PACK_ANCHORS).map((id) => (
        <Layer key={id} id={id} type="background" layout={{ visibility: 'none' }} />
      ))}
    </>
  );
}

interface LandLayersProps {
  id: string;
  data: PackData;
  landVisible: boolean;
  landOpacity: number;
  privateVisible: boolean;
  privateOpacity: number;
  onPress?: PressHandler;
}

/** Public land fills/outlines (§6.3) plus the build-time "likely private" tint (§6.4), all from one source. */
export function LandLayers({
  id,
  data,
  landVisible,
  landOpacity,
  privateVisible,
  privateOpacity,
  onPress,
}: LandLayersProps) {
  const landVis = landVisible ? 'visible' : 'none';
  return (
    <GeoJSONSource id={id} data={data} onPress={onPress}>
      <Layer
        id={`${id}-private-fill`}
        type="fill"
        source={id}
        beforeId={PACK_ANCHORS.land}
        filter={kindIs('private')}
        layout={{ visibility: privateVisible ? 'visible' : 'none' }}
        paint={{ 'fill-color': LIKELY_PRIVATE_COLOR, 'fill-opacity': 0.3 * privateOpacity }}
      />
      <Layer
        id={`${id}-public-fill`}
        type="fill"
        source={id}
        beforeId={PACK_ANCHORS.land}
        filter={kindIs('public')}
        layout={{ visibility: landVis }}
        paint={{ 'fill-color': LAND_FILL_COLOR_EXPRESSION, 'fill-opacity': landOpacity }}
      />
      <Layer
        id={`${id}-outline`}
        type="line"
        source={id}
        beforeId={PACK_ANCHORS.land}
        filter={f(['all', ['==', ['get', 'kind'], 'outline'], ['!=', ['get', 'Pub_Access'], 'RA']])}
        layout={{ visibility: landVis }}
        paint={{ 'line-color': LAND_FILL_COLOR_EXPRESSION, 'line-width': 1.5 }}
      />
      <Layer
        id={`${id}-outline-restricted`}
        type="line"
        source={id}
        beforeId={PACK_ANCHORS.land}
        filter={f(['all', ['==', ['get', 'kind'], 'outline'], ['==', ['get', 'Pub_Access'], 'RA']])}
        layout={{ visibility: landVis }}
        paint={{ 'line-color': PUB_ACCESS_COLORS.RA, 'line-width': 1.5, 'line-dasharray': [2, 2] }}
      />
    </GeoJSONSource>
  );
}

interface MvumLayersProps {
  id: string;
  data: PackData;
  visible: boolean;
  opacity: number;
  onPress?: PressHandler;
}

export function MvumLayers({ id, data, visible, opacity, onPress }: MvumLayersProps) {
  const layout = { visibility: visible ? ('visible' as const) : ('none' as const) };
  return (
    <GeoJSONSource id={id} data={data} onPress={onPress}>
      <Layer
        id={`${id}-line`}
        type="line"
        source={id}
        beforeId={PACK_ANCHORS.mvum}
        filter={f(['!=', ['get', 'seasonal'], 'seasonal'])}
        layout={layout}
        paint={{ 'line-color': MVUM_COLOR_EXPRESSION, 'line-width': 2, 'line-opacity': opacity }}
      />
      {/* Seasonal roads/trails: dashed, so "open now?" is visible at a glance. */}
      <Layer
        id={`${id}-line-seasonal`}
        type="line"
        source={id}
        beforeId={PACK_ANCHORS.mvum}
        filter={f(['==', ['get', 'seasonal'], 'seasonal'])}
        layout={layout}
        paint={{
          'line-color': MVUM_COLOR_EXPRESSION,
          'line-width': 2,
          'line-opacity': opacity,
          'line-dasharray': [2, 2],
        }}
      />
    </GeoJSONSource>
  );
}

interface TrailsLayersProps {
  id: string;
  data: PackData;
  visible: boolean;
  opacity: number;
  showLabels: boolean;
  onPress?: PressHandler;
}

/** USFS trails (src/packs/trails.ts): dashed so they never read as roads, teal for non-motorized, magenta for motorized. */
export function TrailsLayers({ id, data, visible, opacity, showLabels, onPress }: TrailsLayersProps) {
  const layout = {
    visibility: visible ? ('visible' as const) : ('none' as const),
    'line-cap': 'round' as const,
    'line-join': 'round' as const,
  };
  return (
    <GeoJSONSource id={id} data={data} onPress={onPress}>
      <Layer
        id={`${id}-casing`}
        type="line"
        source={id}
        beforeId={PACK_ANCHORS.trails}
        minzoom={9}
        layout={layout}
        paint={{ 'line-color': '#ffffff', 'line-opacity': 0.4 * opacity, 'line-width': 3.6 }}
      />
      <Layer
        id={`${id}-line`}
        type="line"
        source={id}
        beforeId={PACK_ANCHORS.trails}
        minzoom={9}
        layout={layout}
        paint={{
          'line-color': TRAIL_COLOR_EXPRESSION,
          'line-opacity': opacity,
          'line-width': 2,
          'line-dasharray': [2, 1.5],
        }}
      />
      <Layer
        id={`${id}-labels`}
        type="symbol"
        source={id}
        beforeId={PACK_ANCHORS.trails}
        minzoom={12}
        layout={{
          'symbol-placement': 'line',
          'text-field': ['coalesce', ['get', 'name'], ['get', 'trail_no'], ''] as never,
          'text-font': TEXT_FONT,
          'text-size': 11,
          'text-max-angle': 30,
          visibility: visible && showLabels ? 'visible' : 'none',
        }}
        paint={{ 'text-color': '#134e4a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 }}
      />
    </GeoJSONSource>
  );
}

interface PoiLayersProps {
  id: string;
  data: PackData;
  visibility: Record<PoiCategory, boolean>;
  showLabels: boolean;
  /** Receives the tapped feature(s); each carries its `category` property. */
  onPress?: PressHandler;
}

export function PoiLayers({ id, data, visibility, showLabels, onPress }: PoiLayersProps) {
  const categories = Object.keys(POI_CATEGORY_META) as PoiCategory[];
  return (
    <GeoJSONSource id={id} data={data} onPress={onPress}>
      {/* A flat array, not Fragments: the source clones its children to inject `source`, and a Fragment can't take props. */}
      {categories.flatMap((category) => [
          <Layer
            key={`${category}-layer`}
            id={`${id}-${category}-layer`}
            type="circle"
            source={id}
            beforeId={PACK_ANCHORS.poi}
            filter={f(['==', ['get', 'category'], category])}
            layout={{ visibility: visibility[category] ? 'visible' : 'none' }}
            paint={{
              'circle-radius': 6,
              'circle-color': POI_CATEGORY_META[category].color,
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#ffffff',
            }}
          />,
          <Layer
            key={`${category}-label`}
            id={`${id}-${category}-label`}
            type="symbol"
            source={id}
            beforeId={PACK_ANCHORS.poi}
            minzoom={12}
            filter={f(['==', ['get', 'category'], category])}
            layout={{
              'text-field': ['coalesce', ['get', 'name'], ''] as never,
              'text-font': TEXT_FONT,
              'text-size': 11,
              'text-anchor': 'top',
              'text-offset': [0, 0.9],
              'text-optional': true,
              'text-max-width': 8,
              visibility: visibility[category] && showLabels ? 'visible' : 'none',
            }}
            paint={{ 'text-color': '#1f2937', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 }}
          />,
      ])}
    </GeoJSONSource>
  );
}

interface OsmLayersProps {
  id: string;
  data: PackData;
  visible: boolean;
  opacity: number;
  showLabels: boolean;
}

/** Downloaded OpenStreetMap roads & trails (spec §2): casing, solid roads, dashed tracks/paths, and names. */
export function OsmLayers({ id, data, visible, opacity, showLabels }: OsmLayersProps) {
  const layout = { visibility: visible ? ('visible' as const) : ('none' as const), 'line-cap': 'round' as const, 'line-join': 'round' as const };
  const before = PACK_ANCHORS.osm;
  return (
    <GeoJSONSource id={id} data={data}>
      <Layer
        id={`${id}-casing`}
        type="line"
        source={id}
        beforeId={before}
        minzoom={9}
        layout={layout}
        paint={{ 'line-color': '#000000', 'line-opacity': 0.35 * opacity, 'line-width': OSM_CASING_WIDTH }}
      />
      <Layer
        id={`${id}-roads`}
        type="line"
        source={id}
        beforeId={before}
        filter={f(['match', ['get', 'cls'], ['highway', 'primary'], true, false])}
        layout={layout}
        paint={{ 'line-color': OSM_LINE_COLOR, 'line-opacity': opacity, 'line-width': OSM_LINE_WIDTH }}
      />
      <Layer
        id={`${id}-streets`}
        type="line"
        source={id}
        beforeId={before}
        minzoom={11}
        filter={kindOfClass('street')}
        layout={layout}
        paint={{ 'line-color': OSM_LINE_COLOR, 'line-opacity': opacity, 'line-width': OSM_LINE_WIDTH }}
      />
      <Layer
        id={`${id}-tracks`}
        type="line"
        source={id}
        beforeId={before}
        minzoom={10}
        filter={kindOfClass('track')}
        layout={layout}
        paint={{
          'line-color': OSM_LINE_COLOR,
          'line-opacity': opacity,
          'line-width': OSM_LINE_WIDTH,
          'line-dasharray': [3, 1.5],
        }}
      />
      <Layer
        id={`${id}-paths`}
        type="line"
        source={id}
        beforeId={before}
        minzoom={11}
        filter={kindOfClass('path')}
        layout={layout}
        paint={{
          'line-color': OSM_LINE_COLOR,
          'line-opacity': opacity,
          'line-width': OSM_LINE_WIDTH,
          'line-dasharray': [1.5, 1.5],
        }}
      />
      <Layer
        id={`${id}-labels`}
        type="symbol"
        source={id}
        beforeId={before}
        minzoom={12}
        layout={{
          'symbol-placement': 'line',
          'text-field': ['coalesce', ['get', 'name'], ['get', 'ref'], ''] as never,
          'text-font': TEXT_FONT,
          'text-size': 11,
          'text-max-angle': 30,
          visibility: visible && showLabels ? 'visible' : 'none',
        }}
        paint={{ 'text-color': '#1f2937', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 }}
      />
    </GeoJSONSource>
  );
}

function kindOfClass(cls: string) {
  return f(['==', ['get', 'cls'], cls]);
}

/** One downloaded cell of one overlay dataset (a `file://` URI on disk). */
export interface PackCell {
  layer: PackLayerId;
  cx: number;
  cy: number;
  uri: string;
}

/**
 * Downloaded overlay cells, from the coverage table. Bundled starter cells
 * are excluded — their data is compiled into the app and drawn separately.
 * Re-reads whenever a download or delete bumps the pack store.
 */
export function usePackCells(): PackCell[] {
  const db = useSQLiteContext();
  const version = usePackStore((s) => s.version);
  const [cells, setCells] = useState<PackCell[]>([]);

  useEffect(() => {
    let cancelled = false;
    listCoverage(db)
      .then((rows) => {
        if (cancelled) return;
        const next: PackCell[] = [];
        for (const row of rows) {
          const layer = row.layer as PackLayerId;
          if (!PACK_LAYER_IDS.includes(layer)) continue;
          if (row.status !== 'complete' || isCellBundled(layer, row.cell_x, row.cell_y)) continue;
          next.push({ layer, cx: row.cell_x, cy: row.cell_y, uri: packCellUri(layer, row.cell_x, row.cell_y) });
        }
        setCells(next);
      })
      .catch((err) => console.warn('Could not read downloaded overlay coverage', err));
    return () => {
      cancelled = true;
    };
  }, [db, version]);

  return cells;
}
