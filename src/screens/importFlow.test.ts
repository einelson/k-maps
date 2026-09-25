import { Alert, type AlertButton } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { countClosedLines, insertParsedImport, parseImportFile } from '../data/importExport';
import { runImportFlow } from './importFlow';

jest.mock('../data/importExport', () => ({
  parseImportFile: jest.fn(),
  countClosedLines: jest.fn(),
  insertParsedImport: jest.fn(),
}));

const parseImportFileMock = parseImportFile as jest.Mock;
const countClosedLinesMock = countClosedLines as jest.Mock;
const insertParsedImportMock = insertParsedImport as jest.Mock;
const db = {} as SQLiteDatabase;

const parsed = { format: 'gpx', features: [{}, {}, {}] };
const result = { count: 3, folderName: 'Imported: trip' };

/** Replaces Alert.alert with a fake that "taps" the button labelled `tap` (or dismisses when it is null). */
function tapOnAlert(tap: string | null) {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons, options) => {
    if (tap == null) options?.onDismiss?.();
    else (buttons as AlertButton[]).find((b) => b.text === tap)?.onPress?.();
  });
  return spy;
}

beforeEach(() => {
  jest.restoreAllMocks();
  parseImportFileMock.mockReset().mockResolvedValue(parsed);
  countClosedLinesMock.mockReset().mockReturnValue(0);
  insertParsedImportMock.mockReset().mockResolvedValue(result);
});

describe('runImportFlow', () => {
  it('imports straight away, with no prompt, when the user picked the file and nothing is ambiguous', async () => {
    const alert = tapOnAlert('Import');
    await expect(runImportFlow(db, 'file:///a.gpx', 'a.gpx', { confirm: false })).resolves.toBe(result);
    expect(alert).not.toHaveBeenCalled();
    expect(insertParsedImportMock).toHaveBeenCalledWith(db, parsed, 'a.gpx', { closedLinesAsAreas: false });
  });

  it('asks first when another app handed over the file, naming the count and file', async () => {
    const alert = tapOnAlert('Import');
    await runImportFlow(db, 'content://x', 'trip.gpx', { confirm: true });
    expect(alert.mock.calls[0][0]).toBe('Import 3 items?');
    expect(alert.mock.calls[0][1]).toContain('trip.gpx');
    expect(insertParsedImportMock).toHaveBeenCalledTimes(1);
  });

  it('imports nothing and returns null when the confirmation is cancelled', async () => {
    tapOnAlert('Cancel');
    await expect(runImportFlow(db, 'content://x', 'trip.gpx', { confirm: true })).resolves.toBeNull();
    expect(insertParsedImportMock).not.toHaveBeenCalled();
  });

  it('treats dismissing the dialog (back button / tap outside) as cancel', async () => {
    tapOnAlert(null);
    await expect(runImportFlow(db, 'content://x', 'trip.gpx', { confirm: true })).resolves.toBeNull();
    expect(insertParsedImportMock).not.toHaveBeenCalled();
  });

  it('singularises "1 item"', async () => {
    parseImportFileMock.mockResolvedValue({ format: 'kml', features: [{}] });
    const alert = tapOnAlert('Import');
    await runImportFlow(db, 'content://x', 'one.kml', { confirm: true });
    expect(alert.mock.calls[0][0]).toBe('Import 1 item?');
  });

  describe('when the file has closed GPX tracks', () => {
    beforeEach(() => countClosedLinesMock.mockReturnValue(2));

    it('asks even for a file the user picked, and imports them as areas on request', async () => {
      const alert = tapOnAlert('As areas');
      await runImportFlow(db, 'file:///a.gpx', 'a.gpx', { confirm: false });
      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert.mock.calls[0][1]).toContain('2 closed tracks');
      expect(insertParsedImportMock).toHaveBeenCalledWith(db, parsed, 'a.gpx', { closedLinesAsAreas: true });
    });

    it('keeps them as lines on request', async () => {
      tapOnAlert('As lines');
      await runImportFlow(db, 'file:///a.gpx', 'a.gpx', { confirm: false });
      expect(insertParsedImportMock).toHaveBeenCalledWith(db, parsed, 'a.gpx', { closedLinesAsAreas: false });
    });

    it('asks only once when the file also needs confirming (the closed-track prompt doubles as it)', async () => {
      const alert = tapOnAlert('As areas');
      await runImportFlow(db, 'content://x', 'a.gpx', { confirm: true });
      expect(alert).toHaveBeenCalledTimes(1);
    });

    it('imports nothing when cancelled', async () => {
      tapOnAlert('Cancel');
      await expect(runImportFlow(db, 'file:///a.gpx', 'a.gpx', { confirm: false })).resolves.toBeNull();
      expect(insertParsedImportMock).not.toHaveBeenCalled();
    });

    it('uses singular wording for one closed track', async () => {
      countClosedLinesMock.mockReturnValue(1);
      const alert = tapOnAlert('As lines');
      await runImportFlow(db, 'file:///a.gpx', 'a.gpx', { confirm: false });
      expect(alert.mock.calls[0][1]).toContain('1 closed track.');
      expect(alert.mock.calls[0][1]).toContain('as an area');
    });
  });

  it('lets a parse failure through, without prompting or inserting', async () => {
    parseImportFileMock.mockRejectedValue(new Error('No points, lines, or areas found in this file.'));
    const alert = tapOnAlert('Import');
    await expect(runImportFlow(db, 'content://x', 'x', { confirm: true })).rejects.toThrow('No points');
    expect(alert).not.toHaveBeenCalled();
    expect(insertParsedImportMock).not.toHaveBeenCalled();
  });

  it('lets an insert failure through', async () => {
    insertParsedImportMock.mockRejectedValue(new Error('disk full'));
    await expect(runImportFlow(db, 'file:///a.gpx', 'a.gpx', { confirm: false })).rejects.toThrow('disk full');
  });
});
