import { useLayersStore, type OverlayLayerId } from '../state/useLayersStore';
import {
  BASE_MAPS,
  groupedOverlays,
  mapAttribution,
  OVERLAY_GROUPS,
  OVERLAYS,
  overlaysInGroup,
  type OverlayGroupId,
} from './layerOptions';

const storeIds = () => Object.keys(useLayersStore.getInitialState().overlayVisibility) as OverlayLayerId[];
const allOff = () => Object.fromEntries(storeIds().map((id) => [id, false])) as Record<OverlayLayerId, boolean>;

describe('overlay list', () => {
  it('lists every overlay the store knows, exactly once', () => {
    expect(OVERLAYS.map((o) => o.id).sort()).toEqual(storeIds().sort());
  });

  it('has unique, non-empty labels', () => {
    const labels = OVERLAYS.map((o) => o.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label.trim()).not.toBe('');
  });

  it('still offers the three base maps', () => {
    expect(BASE_MAPS.map((b) => b.id)).toEqual(['topo', 'satellite', 'hybrid']);
  });
});

describe('overlay groups', () => {
  it('every overlay belongs to a defined group', () => {
    const groupIds = OVERLAY_GROUPS.map((g) => g.id);
    for (const overlay of OVERLAYS) expect(groupIds).toContain(overlay.group);
  });

  it('groups are non-empty, uniquely labelled and cover every overlay exactly once, in display order', () => {
    const grouped = groupedOverlays();
    expect(grouped.map((g) => g.group.id)).toEqual(OVERLAY_GROUPS.map((g) => g.id));
    for (const { overlays } of grouped) expect(overlays.length).toBeGreaterThan(0);
    expect(new Set(OVERLAY_GROUPS.map((g) => g.label)).size).toBe(OVERLAY_GROUPS.length);
    expect(grouped.flatMap((g) => g.overlays.map((o) => o.id))).toEqual(OVERLAYS.map((o) => o.id));
  });

  it('files each requested layer under the right heading', () => {
    const groupOf = (id: OverlayLayerId) => OVERLAYS.find((o) => o.id === id)!.group;
    const expected: Record<OverlayGroupId, OverlayLayerId[]> = {
      land: ['land', 'likelyPrivate', 'landManager', 'blmSma', 'huntUnits'],
      roads: ['osm', 'mvum', 'usfsTrails'],
      terrain: ['shadedRelief', 'slopeAngle', 'nhd', 'wetlands'],
      hazards: ['wildfire', 'radar'],
    };
    for (const [group, ids] of Object.entries(expected)) {
      expect(overlaysInGroup(group as OverlayGroupId).map((o) => o.id)).toEqual(ids);
      for (const id of ids) expect(groupOf(id)).toBe(group);
    }
  });

  it('marks the live-service overlays as online-only, and the vector data ones as not', () => {
    const online = OVERLAYS.filter((o) => o.onlineOnly).map((o) => o.id).sort();
    expect(online).toEqual(['landManager', 'nhd', 'radar', 'shadedRelief', 'slopeAngle', 'wetlands'].sort());
  });

  it('legend colors are valid hex', () => {
    for (const overlay of OVERLAYS) {
      for (const entry of overlay.legend ?? []) expect(entry.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('the hunting-units note carries IDFG\'s "check the booklet" caveat', () => {
    expect(OVERLAYS.find((o) => o.id === 'huntUnits')!.note).toMatch(/regulation booklet/i);
  });
});

describe('mapAttribution', () => {
  it('always credits USGS, and only credits overlays that are on', () => {
    expect(mapAttribution(allOff())).toBe('© USGS The National Map');
    const withFire = { ...allOff(), wildfire: true, radar: true };
    const text = mapAttribution(withFire);
    expect(text).toContain('© USGS The National Map');
    expect(text).toContain('NIFC');
    expect(text).toContain('NOAA / National Weather Service');
    expect(text).not.toContain('BLM');
  });

  it('does not repeat a credit', () => {
    const everything = Object.fromEntries(storeIds().map((id) => [id, true])) as Record<OverlayLayerId, boolean>;
    const parts = mapAttribution(everything).split(' · ');
    expect(new Set(parts).size).toBe(parts.length);
  });

  it('credits OpenStreetMap when the OSM overlay is on (ODbL requires it)', () => {
    expect(mapAttribution({ ...allOff(), osm: true })).toContain('OpenStreetMap');
  });
});
