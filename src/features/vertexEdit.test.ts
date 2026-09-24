import {
  canRemoveVertex,
  geometryToVertices,
  insertVertex,
  moveVertex,
  removeVertex,
  segmentMidpoints,
  verticesToGeometry,
  type Vertex,
} from './vertexEdit';

const SQUARE: Vertex[] = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
];

describe('geometryToVertices / verticesToGeometry', () => {
  it('round-trips a point', () => {
    const parsed = geometryToVertices({ type: 'Point', coordinates: [-116.2, 43.6] });
    expect(parsed).toEqual({ type: 'point', vertices: [[-116.2, 43.6]] });
    expect(verticesToGeometry('point', parsed!.vertices)).toEqual({ type: 'Point', coordinates: [-116.2, 43.6] });
  });

  it('round-trips a line', () => {
    const coordinates = [
      [0, 0],
      [1, 1],
      [2, 0],
    ];
    const parsed = geometryToVertices({ type: 'LineString', coordinates });
    expect(parsed?.type).toBe('line');
    expect(verticesToGeometry('line', parsed!.vertices)).toEqual({ type: 'LineString', coordinates });
  });

  it('drops the closing duplicate of a polygon ring and re-adds it', () => {
    const ring = [...SQUARE, SQUARE[0]];
    const parsed = geometryToVertices({ type: 'Polygon', coordinates: [ring] });
    expect(parsed?.vertices).toEqual(SQUARE);
    expect(verticesToGeometry('polygon', parsed!.vertices)).toEqual({ type: 'Polygon', coordinates: [ring] });
  });

  it('strips altitude and rejects multi-geometries', () => {
    expect(geometryToVertices({ type: 'Point', coordinates: [1, 2, 300] })?.vertices).toEqual([[1, 2]]);
    expect(geometryToVertices({ type: 'MultiPoint', coordinates: [[0, 0]] })).toBeNull();
  });
});

describe('segmentMidpoints', () => {
  it('has one midpoint per segment for lines', () => {
    expect(segmentMidpoints('line', SQUARE.slice(0, 3))).toEqual([
      { index: 1, coordinates: [1, 0] },
      { index: 2, coordinates: [2, 1] },
    ]);
  });

  it('includes the closing segment for polygons', () => {
    const mids = segmentMidpoints('polygon', SQUARE);
    expect(mids).toHaveLength(4);
    expect(mids[3]).toEqual({ index: 4, coordinates: [0, 1] });
  });

  it('has none for points', () => {
    expect(segmentMidpoints('point', [[0, 0]])).toEqual([]);
  });
});

describe('vertex list operations', () => {
  it('moves, inserts and removes without mutating the input', () => {
    const before = [...SQUARE];
    expect(moveVertex(SQUARE, 1, [5, 5])[1]).toEqual([5, 5]);
    expect(insertVertex(SQUARE, 2, [9, 9]).map((v) => v[0])).toEqual([0, 2, 9, 2, 0]);
    expect(removeVertex(SQUARE, 0)).toEqual(SQUARE.slice(1));
    expect(SQUARE).toEqual(before);
  });

  it('keeps the minimum vertex count per type', () => {
    expect(canRemoveVertex('polygon', SQUARE.slice(0, 3))).toBe(false);
    expect(canRemoveVertex('polygon', SQUARE)).toBe(true);
    expect(canRemoveVertex('line', SQUARE.slice(0, 2))).toBe(false);
    expect(canRemoveVertex('point', [[0, 0]])).toBe(false);
  });
});
