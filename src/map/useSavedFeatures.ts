import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useSQLiteContext } from 'expo-sqlite';
import type { FeatureCollection, Geometry } from 'geojson';

import {
  EMPTY_MAP_FEATURES,
  loadMapFeatures,
  type MapFeatureProperties,
} from '../data/featuresRepo';

/**
 * The user's saved pins/lines/areas as GeoJSON for the map. Reloads whenever
 * the screen regains focus (so edits made in Items/Detail/Import show up on
 * return); call `reload` after saving something from the map screen itself.
 */
export function useSavedFeatures() {
  const db = useSQLiteContext();
  const [data, setData] =
    useState<FeatureCollection<Geometry, MapFeatureProperties>>(EMPTY_MAP_FEATURES);

  const reload = useCallback(async () => {
    try {
      setData(await loadMapFeatures(db));
    } catch (err) {
      console.warn('Failed to load saved features for the map', err);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  return { data, reload };
}
