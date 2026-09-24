import * as Location from 'expo-location';
import type { LocationSubscription } from 'expo-location';
import type { Position } from 'geojson';

import { useTrackRecordingStore } from '../state/useTrackRecordingStore';

/**
 * Foreground-only breadcrumb recording (§7.5). Background location needs
 * extra permissions and battery-care work the spec explicitly calls out as
 * its own concern — not implemented here; keep the app foregrounded while
 * recording, same "keep the screen awake" constraint as downloads (§4.4).
 */
let subscription: LocationSubscription | null = null;

export type StartResult = { ok: true } | { ok: false; reason: string };

export async function startTrackRecording(): Promise<StartResult> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    return { ok: false, reason: 'Location permission was not granted.' };
  }

  useTrackRecordingStore.getState().begin();

  subscription = await Location.watchPositionAsync(
    {
      accuracy: Location.LocationAccuracy.BestForNavigation,
      timeInterval: 3000,
      distanceInterval: 5,
    },
    (location) => {
      useTrackRecordingStore
        .getState()
        .addPoint([location.coords.longitude, location.coords.latitude]);
    }
  );

  return { ok: true };
}

export function stopTrackRecording(): Position[] {
  subscription?.remove();
  subscription = null;
  const { points } = useTrackRecordingStore.getState();
  useTrackRecordingStore.getState().reset();
  return points;
}
