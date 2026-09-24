import { useMemo } from 'react';
import {
  GeoJSONSource,
  Layer,
  ViewAnnotation,
  type PressEventWithFeatures,
} from '@maplibre/maplibre-react-native';
import { StyleSheet, View } from 'react-native';
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';

import { segmentMidpoints, type Vertex } from '../features/vertexEdit';
import { useEditStore } from '../state/useEditStore';

const EDIT_COLOR = '#2f6f4f';
const SELECTED_COLOR = '#f59e0b';

/**
 * The vertex editor's map layers (§7.3 "Edit: select feature, drag vertices,
 * delete vertex"): the shape being edited, a circle on every vertex (tap to
 * select), a hollow circle at every segment midpoint (tap to insert a vertex),
 * and — for the selected vertex only — one draggable native handle. Keeping
 * drag to a single native view means a 5,000-point GPS track costs no more
 * than a triangle; the other vertices are cheap circle-layer features.
 */
export function EditLayers() {
  const type = useEditStore((s) => s.type);
  const vertices = useEditStore((s) => s.vertices);
  const selected = useEditStore((s) => s.selected);
  const select = useEditStore((s) => s.select);
  const move = useEditStore((s) => s.move);
  const insert = useEditStore((s) => s.insert);

  const shape = useMemo<Feature<Point | LineString | Polygon> | null>(() => {
    if (!type || vertices.length === 0) return null;
    if (type === 'point') return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: vertices[0] } };
    if (type === 'line' || vertices.length < 3) {
      if (vertices.length < 2) return null;
      return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: vertices } };
    }
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[...vertices, vertices[0]]] },
    };
  }, [type, vertices]);

  const vertexData = useMemo<FeatureCollection<Point, { index: number; selected: boolean }>>(
    () => ({
      type: 'FeatureCollection',
      features: vertices.map((coordinates, index) => ({
        type: 'Feature',
        properties: { index, selected: index === selected },
        geometry: { type: 'Point', coordinates },
      })),
    }),
    [vertices, selected]
  );

  const midpointData = useMemo<FeatureCollection<Point, { index: number }>>(
    () => ({
      type: 'FeatureCollection',
      features: type
        ? segmentMidpoints(type, vertices).map(({ index, coordinates }) => ({
            type: 'Feature',
            properties: { index },
            geometry: { type: 'Point', coordinates },
          }))
        : [],
    }),
    [type, vertices]
  );

  if (!type) return null;

  function handleVertexPress(event: { nativeEvent: PressEventWithFeatures; stopPropagation?: () => void }) {
    event.stopPropagation?.();
    const index = event.nativeEvent.features[0]?.properties?.index;
    if (typeof index === 'number') select(index === selected ? null : index);
  }

  function handleMidpointPress(event: { nativeEvent: PressEventWithFeatures; stopPropagation?: () => void }) {
    event.stopPropagation?.();
    const feature = event.nativeEvent.features[0];
    const index = feature?.properties?.index;
    if (typeof index !== 'number' || feature?.geometry.type !== 'Point') return;
    const [lon, lat] = feature.geometry.coordinates;
    insert(index, [lon, lat]);
  }

  const selectedVertex: Vertex | null = selected != null ? (vertices[selected] ?? null) : null;

  return (
    <>
      {shape && (
        <GeoJSONSource id="edit-shape" data={shape}>
          {shape.geometry.type === 'Polygon' && (
            <Layer
              id="edit-shape-fill-layer"
              type="fill"
              source="edit-shape"
              paint={{ 'fill-color': EDIT_COLOR, 'fill-opacity': 0.18 }}
            />
          )}
          {shape.geometry.type !== 'Point' && (
            <Layer
              id="edit-shape-line-layer"
              type="line"
              source="edit-shape"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{ 'line-color': EDIT_COLOR, 'line-width': 3.5 }}
            />
          )}
        </GeoJSONSource>
      )}

      <GeoJSONSource id="edit-midpoints" data={midpointData} onPress={handleMidpointPress}>
        <Layer
          id="edit-midpoints-layer"
          type="circle"
          source="edit-midpoints"
          paint={{
            'circle-radius': 6,
            'circle-color': '#ffffff',
            'circle-opacity': 0.75,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': EDIT_COLOR,
          }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="edit-vertices" data={vertexData} onPress={handleVertexPress}>
        <Layer
          id="edit-vertices-layer"
          type="circle"
          source="edit-vertices"
          paint={{
            'circle-radius': 8,
            'circle-color': '#ffffff',
            'circle-stroke-width': 2.5,
            'circle-stroke-color': EDIT_COLOR,
          }}
        />
      </GeoJSONSource>

      {selectedVertex && selected != null && (
        <ViewAnnotation
          id="edit-handle"
          lngLat={selectedVertex}
          draggable
          onDragEnd={(event) => {
            const [lon, lat] = event.nativeEvent.lngLat;
            move(selected, [lon, lat]);
          }}
        >
          <View style={styles.handle} />
        </ViewAnnotation>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  handle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: SELECTED_COLOR,
    borderWidth: 3,
    borderColor: '#ffffff',
  },
});
