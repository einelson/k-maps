import {
  boxesIntersect,
  HUNT_STATE_MARGIN_DEGREES,
  HUNT_STATE_MAX_MOUNTED,
  HUNT_STATE_MIN_ZOOM,
  huntStatesInView,
  sameViewBox,
  viewBoxOf,
  type Box,
} from './huntUnitWindow';

// Rough real boxes: [west, south, east, north].
const OREGON = { code: 'OR', bbox: [-124.6, 41.9, -116.4, 46.3] as Box };
const WASHINGTON = { code: 'WA', bbox: [-124.8, 45.5, -116.9, 49.0] as Box };
const WYOMING = { code: 'WY', bbox: [-111.1, 41.0, -104.0, 45.0] as Box };
const FLORIDA = { code: 'FL', bbox: [-87.7, 24.5, -80.0, 31.0] as Box };

const view = (bounds: Box, zoom = 7, center: [number, number] = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]) =>
  viewBoxOf({ bounds, center, zoom });

describe('viewBoxOf', () => {
  it('rounds the box outward and the center to the nearest half degree, and the zoom down', () => {
    const v = viewBoxOf({ bounds: [-116.12, 43.03, -115.41, 43.61], center: [-115.76, 43.32], zoom: 9.8 });
    expect(v.bounds).toEqual([-116.5, 43, -115, 44]);
    expect(v.centerLon).toBe(-116);
    expect(v.centerLat).toBe(43.5);
    expect(v.zoom).toBe(9);
  });

  it('stays the same while the camera moves within a step', () => {
    const a = viewBoxOf({ bounds: [-116.12, 43.03, -115.41, 43.61], center: [-115.9, 43.32], zoom: 9.2 });
    const b = viewBoxOf({ bounds: [-116.10, 43.05, -115.44, 43.58], center: [-115.85, 43.31], zoom: 9.6 });
    expect(sameViewBox(a, b)).toBe(true);
  });

  it('sameViewBox tells different views apart, and handles null', () => {
    const a = view([-117, 43, -115, 44]);
    expect(sameViewBox(a, view([-117, 43, -115, 44], 8))).toBe(false);
    expect(sameViewBox(a, view([-117, 43, -114, 44]))).toBe(false);
    expect(sameViewBox(null, null)).toBe(true);
    expect(sameViewBox(a, null)).toBe(false);
  });
});

describe('boxesIntersect', () => {
  it('is true for overlapping and touching boxes, false for apart', () => {
    expect(boxesIntersect([0, 0, 2, 2], [1, 1, 3, 3])).toBe(true);
    expect(boxesIntersect([0, 0, 1, 1], [1, 1, 2, 2])).toBe(true);
    expect(boxesIntersect([0, 0, 1, 1], [2, 2, 3, 3])).toBe(false);
  });
});

describe('huntStatesInView', () => {
  const states = [OREGON, WASHINGTON, WYOMING, FLORIDA];

  it('mounts nothing before the view is known', () => {
    expect(huntStatesInView(states, null)).toEqual([]);
  });

  it('mounts nothing when zoomed out to a continent', () => {
    expect(huntStatesInView(states, view([-125, 24, -66, 50], HUNT_STATE_MIN_ZOOM - 1))).toEqual([]);
  });

  it('keeps only the states overlapping the view', () => {
    const boise = view([-117, 43, -115, 44], 9); // inside Oregon's box? No: OR ends at -116.4 so this touches it
    const codes = huntStatesInView(states, boise).map((s) => s.code);
    expect(codes).toContain('OR');
    expect(codes).not.toContain('FL');
    expect(codes).not.toContain('WY');
  });

  it('includes a state just off-screen, within the margin, but not one beyond it', () => {
    // A view whose east edge stops well short of Wyoming's west edge (-111.1).
    const near = view([-114.5, 42, -111.1 - HUNT_STATE_MARGIN_DEGREES + 0.01, 43], 8);
    expect(huntStatesInView(states, near).map((s) => s.code)).toContain('WY');
    const far = view([-115.5, 42, -112, 43], 8);
    expect(huntStatesInView(states, far).map((s) => s.code)).not.toContain('WY');
  });

  it('orders overlapping states nearest the view center first', () => {
    const pnw = view([-125, 42, -116, 49], 6, [-123, 48.5]); // centered up by Washington
    expect(huntStatesInView(states, pnw).map((s) => s.code)).toEqual(['WA', 'OR']);
  });

  it('caps how many states mount at once, keeping the nearest', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ code: `S${i}`, bbox: [-100 + i * 0.1, 40, -99 + i * 0.1, 41] as Box }));
    const mounted = huntStatesInView(many, view([-105, 35, -90, 45], 5, [-100, 40]));
    expect(mounted).toHaveLength(HUNT_STATE_MAX_MOUNTED);
    expect(mounted[0].code).toBe('S0');
  });
});
