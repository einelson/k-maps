import type { SQLiteDatabase } from 'expo-sqlite';
import type { Position } from 'geojson';

import type { TrackSamples } from '../features/trackStats';
import { createFeature } from './featuresRepo';
import { clearRecordingRows } from './recordingRepo';
import { saveTrackData } from './trackDataRepo';

/** A finished recording, ready to become a saved line. */
export interface RecordedTrack {
  points: Position[];
  samples: TrackSamples;
  startedAt: number | null;
}

/** "Track 9/24/2026, 5:02:03 PM": named for when it started, so a list of tracks sorts itself out. */
export function defaultTrackName(startedAt: number | null): string {
  return `Track ${new Date(startedAt ?? Date.now()).toLocaleString()}`;
}

/**
 * Saves a finished recording as a line (`source: 'track'`) plus its per-point time and altitude, in one
 * transaction so a track never exists without its samples. `clearRecording` also removes the in-progress
 * recording in the same transaction, so a crash can't leave it saved *and* still pending (which would save
 * it a second time on the next launch). Returns the new feature's id.
 */
export async function saveRecordedTrack(
  db: SQLiteDatabase,
  track: RecordedTrack,
  options: { clearRecording?: boolean } = {}
): Promise<number> {
  if (track.points.length < 2) throw new Error('A track needs at least two points.');
  let featureId = 0;
  await db.withTransactionAsync(async () => {
    featureId = await createFeature(db, {
      name: defaultTrackName(track.startedAt),
      geometry: { type: 'LineString', coordinates: track.points },
      source: 'track',
    });
    await saveTrackData(db, featureId, track.samples);
    if (options.clearRecording) await clearRecordingRows(db);
  });
  return featureId;
}
