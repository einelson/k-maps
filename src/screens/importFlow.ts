import { Alert } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  countClosedLines,
  insertParsedImport,
  parseImportFile,
  type ImportResult,
} from '../data/importExport';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface Choice<T> {
  label: string;
  value: T;
}

/** Resolves with the tapped choice's value, or null when the user cancels or dismisses the dialog. */
function ask<T>(title: string, message: string, choices: Choice<T>[]): Promise<T | null> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
        ...choices.map((choice) => ({ text: choice.label, onPress: () => resolve(choice.value) })),
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}

/**
 * Parses a file first, then asks only what the file makes worth asking:
 * - GPX has no area type, so apps export areas (onX's "shapes") as closed tracks. When the file has any, ask
 *   whether to import them as areas or leave them as lines;
 * - `confirm` (a file another app handed us, rather than one the user just picked) asks before adding anything.
 * Returns null when the user backs out; throws for an unreadable or empty file.
 */
export async function runImportFlow(
  db: SQLiteDatabase,
  uri: string,
  fileName: string,
  { confirm }: { confirm: boolean }
): Promise<ImportResult | null> {
  const parsed = await parseImportFile(uri, fileName);
  const total = plural(parsed.features.length, 'item');

  const closed = countClosedLines(parsed);
  let closedLinesAsAreas = false;
  if (closed > 0) {
    const choice = await ask(
      `Import ${total}?`,
      `${fileName} has ${plural(closed, 'closed track')}. Apps like onX export areas as closed GPX tracks. Import ${
        closed === 1 ? 'it' : 'them'
      } as ${closed === 1 ? 'an area' : 'areas'}, or keep ${closed === 1 ? 'it' : 'them'} as lines?`,
      [
        { label: 'As lines', value: 'lines' as const },
        { label: 'As areas', value: 'areas' as const },
      ]
    );
    if (!choice) return null;
    closedLinesAsAreas = choice === 'areas';
  } else if (confirm) {
    const ok = await ask(`Import ${total}?`, `From ${fileName}. They'll be added in a new folder.`, [
      { label: 'Import', value: true },
    ]);
    if (!ok) return null;
  }

  return insertParsedImport(db, parsed, fileName, { closedLinesAsAreas });
}
