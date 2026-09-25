import { mockFetch, jsonResponse } from '../packs/testUtils.ts';
import { REGION_PACK_FORMAT, REGION_PACK_MANIFEST_URL } from '../packs/regionPacks.ts';
import { fetchRegionManifest } from './regionManifest';

const manifest = {
  format: REGION_PACK_FORMAT,
  regions: [{ id: 'idaho', name: 'Idaho', cells: [[1, 2]], packs: [] }],
};

describe('fetchRegionManifest', () => {
  it('fetches and parses the manifest from the rolling release URL', async () => {
    const { calls } = mockFetch(() => jsonResponse(manifest));
    await expect(fetchRegionManifest()).resolves.toMatchObject({ regions: [{ id: 'idaho' }] });
    expect(calls.length).toBe(1);
    expect(REGION_PACK_MANIFEST_URL).toMatch(/^https:\/\/github\.com\/einelson\/k-maps\/releases\/download\/data\/manifest\.json$/);
  });

  it('says so plainly when nothing has been published (404)', async () => {
    mockFetch(() => jsonResponse({}, 404));
    await expect(fetchRegionManifest()).rejects.toThrow('No region packs have been published yet');
  });

  it('retries a flaky connection, then reports it as a connection problem', async () => {
    const { calls } = mockFetch(() => jsonResponse({}, 503));
    await expect(fetchRegionManifest()).rejects.toThrow(/check your connection/);
    expect(calls.length).toBe(3); // first attempt + 2 retries
  });

  it('surfaces a manifest this app is too old for', async () => {
    mockFetch(() => jsonResponse({ ...manifest, format: REGION_PACK_FORMAT + 1 }));
    await expect(fetchRegionManifest()).rejects.toThrow(/update the app/);
  });

  it('rejects with an AbortError when aborted', async () => {
    mockFetch(() => jsonResponse(manifest));
    const controller = new AbortController();
    controller.abort();
    await expect(fetchRegionManifest(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
