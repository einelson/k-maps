import { fileNameFromUrl, isImportableUrl } from './IncomingImportHandler';

jest.mock('expo-sqlite', () => ({ useSQLiteContext: jest.fn() }));
jest.mock('../screens/importFlow', () => ({ runImportFlow: jest.fn() }));
jest.mock('./navigationRef', () => ({ navigationRef: {} }));

describe('isImportableUrl', () => {
  it('accepts content:// and file:// URIs, in any case', () => {
    expect(isImportableUrl('content://com.android.providers.downloads.documents/document/42')).toBe(true);
    expect(isImportableUrl('file:///storage/emulated/0/Download/trip.gpx')).toBe(true);
    expect(isImportableUrl('CONTENT://x/y')).toBe(true);
  });

  it('rejects deep links and web URLs', () => {
    expect(isImportableUrl('kmaps://open?x=1')).toBe(false);
    expect(isImportableUrl('https://example.com/trip.gpx')).toBe(false);
    expect(isImportableUrl('')).toBe(false);
  });
});

describe('fileNameFromUrl', () => {
  it('reads a plain file name from a file:// URI', () => {
    expect(fileNameFromUrl('file:///storage/emulated/0/Download/trip.gpx')).toBe('trip.gpx');
  });

  it('decodes a percent-encoded path from a documents provider down to the file name', () => {
    expect(
      fileNameFromUrl('content://com.android.externalstorage.documents/document/primary%3ADownload%2Fonx%20trip.kmz')
    ).toBe('onx trip.kmz');
  });

  it('ignores a query string or fragment', () => {
    expect(fileNameFromUrl('content://provider/files/trip.gpx?token=abc#frag')).toBe('trip.gpx');
  });

  it('falls back to a generic label when the last segment is an opaque id', () => {
    expect(fileNameFromUrl('content://com.android.providers.downloads.documents/document/42')).toBe('shared file');
    expect(fileNameFromUrl('content://com.android.providers.downloads.documents/document/msf%3A1000012345')).toBe(
      'shared file'
    );
    expect(fileNameFromUrl('content://provider/')).toBe('shared file');
  });

  it('survives a malformed percent escape', () => {
    expect(fileNameFromUrl('content://provider/files/100%.gpx')).toBe('100%.gpx');
  });
});
