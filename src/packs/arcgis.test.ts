import { queryArcGisFeatures } from './arcgis.ts';
import { jsonResponse, mockFetch } from './testUtils.ts';

const feat = (id: number) => ({
  type: 'Feature',
  properties: { OBJECTID: id },
  geometry: { type: 'Point', coordinates: [0, 0] },
});

describe('queryArcGisFeatures', () => {
  it('returns a single page as-is', async () => {
    const { calls } = mockFetch(() => jsonResponse({ type: 'FeatureCollection', features: [feat(1), feat(2)] }));
    const out = await queryArcGisFeatures('https://svc/layer/0', { where: '1=1' });
    expect(out).toHaveLength(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://svc/layer/0/query');
    expect(calls[0].params.get('f')).toBe('geojson');
    expect(calls[0].params.get('where')).toBe('1=1');
  });

  it('pages with resultOffset until a short page (paginate mode)', async () => {
    const pages = [[feat(1), feat(2)], [feat(3), feat(4)], [feat(5)]];
    const { calls } = mockFetch((c) => {
      const offset = Number(c.params.get('resultOffset'));
      return jsonResponse({ type: 'FeatureCollection', features: pages[offset / 2] });
    });
    const out = await queryArcGisFeatures('https://svc/layer/0', {}, { paginate: true, pageSize: 2 });
    expect(out.map((f) => f.properties!.OBJECTID)).toEqual([1, 2, 3, 4, 5]);
    expect(calls.map((c) => c.params.get('resultOffset'))).toEqual(['0', '2', '4']);
    expect(calls[0].params.get('resultRecordCount')).toBe('2');
    expect(calls[0].params.get('orderByFields')).toBe('OBJECTID');
  });

  it('keeps paging while exceededTransferLimit is set even if a page is short, and stops on an empty page', async () => {
    const { calls } = mockFetch((c) => {
      const offset = Number(c.params.get('resultOffset'));
      if (offset === 0) return jsonResponse({ features: [feat(1)], exceededTransferLimit: true });
      if (offset === 1) return jsonResponse({ features: [feat(2)], properties: { exceededTransferLimit: true } });
      return jsonResponse({ features: [] });
    });
    const out = await queryArcGisFeatures('https://svc/layer/0', {}, { paginate: true, pageSize: 5 });
    expect(out).toHaveLength(2);
    expect(calls).toHaveLength(3);
  });

  it('falls back to returnIdsOnly + objectIds chunks when a non-paginating layer truncates', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => i + 100);
    const { calls } = mockFetch((c) => {
      if (c.params.get('returnIdsOnly') === 'true') return jsonResponse({ objectIdFieldName: 'FID', objectIds: ids });
      const wanted = c.params.get('objectIds');
      if (wanted) return jsonResponse({ features: wanted.split(',').map((id) => feat(Number(id))) });
      return jsonResponse({ features: [feat(1)], exceededTransferLimit: true });
    });
    const out = await queryArcGisFeatures(
      'https://svc/layer/5',
      { geometry: '0,0,1,1', geometryType: 'esriGeometryEnvelope', inSR: 4326, spatialRel: 'esriSpatialRelIntersects', outFields: 'a' },
      { pageSize: 10 }
    );
    expect(out.map((f) => f.properties!.OBJECTID)).toEqual(ids);
    const idCalls = calls.filter((c) => c.params.get('objectIds'));
    expect(idCalls).toHaveLength(3); // 10 + 10 + 5
    expect(idCalls[0].params.get('geometry')).toBeNull(); // spatial filter dropped when fetching by id
    expect(idCalls[0].params.get('outFields')).toBe('a');
  });

  it('throws on an ArcGIS error body, but retries 5xx-coded ones', async () => {
    mockFetch(() => jsonResponse({ error: { code: 400, message: 'Invalid query' } }));
    await expect(queryArcGisFeatures('https://svc/l', {})).rejects.toThrow('Invalid query');

    const { calls } = mockFetch((_c, i) =>
      i === 0 ? jsonResponse({ error: { code: 500, message: 'Error performing query operation' } }) : jsonResponse({ features: [feat(1)] })
    );
    await expect(queryArcGisFeatures('https://svc/l', {})).resolves.toHaveLength(1);
    expect(calls).toHaveLength(2);
  });
});
