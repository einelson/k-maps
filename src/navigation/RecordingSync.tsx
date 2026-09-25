import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { restoreRecording, syncRecording } from '../features/trackRecorder';
import { useTrackRecordingStore } from '../state/useTrackRecordingStore';

/** How often the on-screen recording catches up with what the background task has stored. */
export const SYNC_INTERVAL_MS = 2000;

const warn = (what: string) => (err: unknown) => console.warn(what, err);

/**
 * Keeps the on-screen recording in step with the one in SQLite. The background task writes fixes there even
 * when the app is closed, so this rebuilds the live recording when the app opens or returns to the front, then
 * polls for new fixes while one is running. Renders nothing.
 */
export function RecordingSync() {
  const db = useSQLiteContext();
  const recording = useTrackRecordingStore((s) => s.recording);

  useEffect(() => {
    restoreRecording(db).catch(warn('Could not restore the recording'));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') restoreRecording(db).catch(warn('Could not restore the recording'));
    });
    return () => subscription.remove();
  }, [db]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => syncRecording(db).catch(warn('Could not sync the recording')), SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [db, recording]);

  return null;
}
