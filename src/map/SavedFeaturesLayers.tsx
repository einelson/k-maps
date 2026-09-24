import { useMemo, useRef } from 'react';
import {
  GeoJSONSource,
  Layer,
  type GeoJSONSourceRef,
  type PressEventWithFeatures,
} from '@maplibre/maplibre-react-native';
import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Geometry, Point } from 'geojson';

import type { MapFeatureProperties } from '../data/featuresRepo';
import type { FeatureType } from '../data/types';
import type { Filters } from '../state/types';
import { buildFeatureFilter, matchesFilters } from './filterExpression';
import { TEXT_FONT } from './glyphs';
import { PinSymbolLayers } from './PinLayers';

interface SavedFeaturesLayersProps {
  data: FeatureCollection<Geometry, MapFeatureProperties>;
  filters: Filters;
  showLabels?: boolean;
  /** A feature being edited is drawn by the editor instead, so it's left out here. */
  hiddenFeatureId?: number | null;
  /** Omit to make the layers non-interactive (e.g. while a draw tool is active). */
  onPressFeature?: (featureId: number) => void;
  /** Tapping a cluster asks the host to zoom in on it. */
  onZoomTo?: (center: [number, number], zoom: number) => void;
}

const COLOR = ['get', 'displayColor'] as unknown as string;
const NAME = ['coalesce', ['get', 'name'], ''] as unknown as string;

/** Point clusters form at low zoom and dissolve by this zoom (§7.2: "enable clustering for points"). */
const CLUSTER_MAX_ZOOM = 13;

const LABEL_LAYOUT = {
  'text-field': NAME,
  'text-font': TEXT_FONT,
  'text-size': 12,
  'text-optional': true,
  'text-max-width': 8,
} as const;

const LABEL_PAINT = {
  'text-color': '#1f2937',
  'text-halo-color': '#ffffff',
  'text-halo-width': 1.6,
} as const;

/**
 * The user's own data on the map (§5.1 layer 5): areas, lines, points.
 *
 * Lines and areas live in one GeoJSON source whose layers all share the §7.2
 * filter expression, so folder/type/color/tag toggles are instant and never
 * touch SQLite. Points are in their own CLUSTERED source instead: a cluster is
 * built from the source's raw points, so a layer filter couldn't take a hidden
 * point out of a cluster's count — that source is fed the already-filtered
 * points (`matchesFilters`, the JS twin of the expression). Name labels use the
 * bundled glyphs (src/map/glyphs.ts), so they work offline.
 */
export function SavedFeaturesLayers({
  data,
  filters,
  showLabels = true,
  hiddenFeatureId = null,
  onPressFeature,
  onZoomTo,
}: SavedFeaturesLayersProps) {
  const pointsSourceRef = useRef<GeoJSONSourceRef>(null);

  const shapesData = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: data.features.filter((f) => f.geometry.type !== 'Point'),
    }),
    [data]
  );

  const allPoints = useMemo(
    () => data.features.filter((f): f is Feature<Point, MapFeatureProperties> => f.geometry.type === 'Point'),
    [data]
  );

  const pointsData = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: allPoints.filter(
        (f) => f.properties.featureId !== hiddenFeatureId && matchesFilters(f.properties, filters)
      ),
    }),
    [allPoints, filters, hiddenFeatureId]
  );

  const userFilter = useMemo(() => buildFeatureFilter(filters), [filters]);

  const filterFor = (type: FeatureType) =>
    [
      'all',
      ['==', ['get', 'type'], type],
      userFilter,
      ['!=', ['get', 'featureId'], hiddenFeatureId ?? -1],
    ] as unknown as FilterSpecification;

  function handlePress(event: {
    nativeEvent: PressEventWithFeatures;
    stopPropagation?: () => void;
  }) {
    event.stopPropagation?.();
    const featureId = event.nativeEvent.features[0]?.properties?.featureId;
    if (typeof featureId === 'number') onPressFeature?.(featureId);
  }

  async function handlePointsPress(event: {
    nativeEvent: PressEventWithFeatures;
    stopPropagation?: () => void;
  }) {
    event.stopPropagation?.();
    const feature = event.nativeEvent.features[0];
    if (!feature) return;
    const clusterId = feature.properties?.cluster_id;
    if (typeof clusterId === 'number' && feature.geometry.type === 'Point') {
      const zoom = await pointsSourceRef.current?.getClusterExpansionZoom(clusterId);
      const [lon, lat] = feature.geometry.coordinates;
      if (zoom != null) onZoomTo?.([lon, lat], zoom + 0.5);
      return;
    }
    const featureId = feature.properties?.featureId;
    if (typeof featureId === 'number') onPressFeature?.(featureId);
  }

  const interactive = onPressFeature != null;

  return (
    <>
      <GeoJSONSource
        id="saved-features"
        data={shapesData}
        onPress={interactive ? handlePress : undefined}
      >
        <Layer
          id="saved-polygon-fill-layer"
          type="fill"
          source="saved-features"
          filter={filterFor('polygon')}
          paint={{ 'fill-color': COLOR, 'fill-opacity': 0.25 }}
        />
        <Layer
          id="saved-polygon-outline-layer"
          type="line"
          source="saved-features"
          filter={filterFor('polygon')}
          layout={{ 'line-join': 'round' }}
          paint={{ 'line-color': COLOR, 'line-width': 2.5 }}
        />
        <Layer
          id="saved-line-layer"
          type="line"
          source="saved-features"
          filter={filterFor('line')}
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
          paint={{ 'line-color': COLOR, 'line-width': 3.5 }}
        />
        <Layer
          id="saved-polygon-label-layer"
          type="symbol"
          source="saved-features"
          filter={filterFor('polygon')}
          layout={{ ...LABEL_LAYOUT, 'text-size': 13, visibility: showLabels ? 'visible' : 'none' }}
          paint={LABEL_PAINT}
        />
        <Layer
          id="saved-line-label-layer"
          type="symbol"
          source="saved-features"
          filter={filterFor('line')}
          layout={{
            ...LABEL_LAYOUT,
            'symbol-placement': 'line',
            'text-max-angle': 30,
            visibility: showLabels ? 'visible' : 'none',
          }}
          paint={LABEL_PAINT}
        />
      </GeoJSONSource>

      <GeoJSONSource
        id="saved-points"
        ref={pointsSourceRef}
        data={pointsData}
        cluster
        clusterRadius={44}
        clusterMaxZoom={CLUSTER_MAX_ZOOM}
        onPress={interactive ? handlePointsPress : undefined}
      >
        <Layer
          id="saved-cluster-layer"
          type="circle"
          source="saved-points"
          filter={['has', 'point_count']}
          paint={{
            'circle-color': '#2f6f4f',
            'circle-opacity': 0.9,
            'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 25] as never,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          }}
        />
        <Layer
          id="saved-cluster-count-layer"
          type="symbol"
          source="saved-points"
          filter={['has', 'point_count']}
          layout={{
            'text-field': ['to-string', ['get', 'point_count']] as never,
            'text-font': TEXT_FONT,
            'text-size': 13,
            'text-allow-overlap': true,
          }}
          paint={{ 'text-color': '#ffffff' }}
        />
        <PinSymbolLayers id="saved-point" source="saved-points" filter={['!', ['has', 'point_count']]} />
        <Layer
          id="saved-point-label-layer"
          type="symbol"
          source="saved-points"
          filter={['!', ['has', 'point_count']]}
          layout={{
            ...LABEL_LAYOUT,
            'text-anchor': 'top',
            'text-offset': [0, 0.2],
            visibility: showLabels ? 'visible' : 'none',
          }}
          paint={LABEL_PAINT}
        />
      </GeoJSONSource>
    </>
  );
}
