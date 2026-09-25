import { useEffect } from 'react';
import { Alert, Linking } from 'react-native';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';

import { runImportFlow } from '../screens/importFlow';
import { navigationRef } from './navigationRef';

/** Files other apps open in K-Maps arrive as `content://` (or `file://`) URIs; deep links use other schemes. */
export function isImportableUrl(url: string): boolean {
  return /^(content|file):\/\//i.test(url);
}

/**
 * Best-effort display name for a shared file. `content://` URIs usually end in an opaque document id or a
 * percent-encoded path (`primary%3ADownload%2Ftrip.gpx`); it's only used for the folder label and prompts,
 * since the format is sniffed from the content.
 */
export function fileNameFromUrl(url: string): string {
  let segment = url.split(/[?#]/)[0].split('/').pop() ?? '';
  try {
    segment = decodeURIComponent(segment);
  } catch {
    // Malformed escape sequence: use the raw segment.
  }
  segment = segment.split(/[/:]/).pop() ?? '';
  return /\.[a-z0-9]{2,8}$/i.test(segment) ? segment : 'shared file';
}

async function offerImport(db: SQLiteDatabase, url: string): Promise<void> {
  try {
    const result = await runImportFlow(db, url, fileNameFromUrl(url), { confirm: true });
    if (!result) return;
    Alert.alert(
      'Import complete',
      `Added ${result.count} item${result.count === 1 ? '' : 's'} to "${result.folderName}".`,
      [
        { text: 'OK' },
        { text: 'View', onPress: () => navigationRef.isReady() && navigationRef.navigate('Items') },
      ]
    );
  } catch (err) {
    Alert.alert("Couldn't import this file", err instanceof Error ? err.message : String(err));
  }
}

// The launch URL stays available for the whole life of the JS context, so only look at it once.
let initialUrlChecked = false;

/**
 * "Open with K-Maps" for GPX/KML/KMZ/GeoJSON files (the Android intent filters live in app.json). Renders
 * nothing; it listens for the file that launched the app and for files opened while it's already running.
 */
export function IncomingImportHandler() {
  const db = useSQLiteContext();

  useEffect(() => {
    const handle = (url: string | null) => {
      if (url && isImportableUrl(url)) void offerImport(db, url);
    };

    if (!initialUrlChecked) {
      initialUrlChecked = true;
      Linking.getInitialURL().then(handle, () => {});
    }
    const subscription = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => subscription.remove();
  }, [db]);

  return null;
}
