import type { OverlayLayerId } from '../state/useLayersStore';
import { HUNT_UNIT_COLOR } from './huntUnitsStyle';
import { LAND_MANAGER_LEGEND, SLOPE_CLASSES, type LegendEntry } from './liveOverlays';
import { TRAIL_CLASS_COLORS, TRAIL_CLASS_LABELS } from './trailsSource';
import { USGS_ATTRIBUTION, type BaseMapMode } from './usgsSources';
import { PRESCRIBED_COLOR, WILDFIRE_COLOR } from './wildfireSource';

/** Base map choices, shared by the map's layers panel and the full Layers screen. */
export const BASE_MAPS: { id: BaseMapMode; label: string }[] = [
  { id: 'topo', label: 'Topo' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'hybrid', label: 'Hybrid' },
];

/** The sections overlays are sorted into, in display order. (Points of interest are their own section.) */
export type OverlayGroupId = 'land' | 'roads' | 'terrain' | 'hazards';

export const OVERLAY_GROUPS: { id: OverlayGroupId; label: string; blurb: string }[] = [
  { id: 'land', label: 'Land & access', blurb: 'Who owns it and where you can go' },
  { id: 'roads', label: 'Roads & trails', blurb: 'Getting there, by vehicle or on foot' },
  { id: 'terrain', label: 'Water & terrain', blurb: 'Streams, wetlands and steepness' },
  { id: 'hazards', label: 'Hazards & conditions', blurb: 'Live — fire and weather right now' },
];

export interface OverlayOption {
  id: OverlayLayerId;
  label: string;
  group: OverlayGroupId;
  /** The long-form explanation the Layers screen shows under the toggle. */
  note?: string;
  disabled?: boolean;
  /** Needs a connection: drawn from a live service, with nothing to download. */
  onlineOnly?: boolean;
  /** For overlays with more data to download: the text of a link under the toggle that opens the Downloads screen. */
  downloadsLink?: string;
  /** Color key shown on the Layers screen while the overlay is on. */
  legend?: LegendEntry[];
  /** Credit added to the on-map attribution while the overlay is on. */
  attribution?: string;
}

/** Toggleable overlays, listed group by group (so the flat list and the grouped view agree on order). */
export const OVERLAYS: OverlayOption[] = [
  // --- Land & access ---
  {
    id: 'land',
    group: 'land',
    label: 'Public land',
    note: 'Green = open access, amber (dashed) = restricted, red = closed, blue-gray = unknown. Loads automatically for the area you are viewing while online, and stays on the device.',
    attribution: 'USGS PAD-US',
  },
  {
    id: 'likelyPrivate',
    group: 'land',
    label: 'Likely private shading',
    note: 'Purple tint = not in any public-land data, so likely private (inferred, not a parcel record). Drawn wherever public-land data is loaded.',
  },
  {
    id: 'landManager',
    group: 'land',
    label: 'Land managers (BLM SMA)',
    note: 'Federal land colored by managing agency — BLM vs. Forest Service vs. Park Service vs. state — for the whole US. Separate from PAD-US, which classifies by protection status.',
    onlineOnly: true,
    legend: LAND_MANAGER_LEGEND,
    attribution: 'BLM National SMA',
  },
  {
    id: 'blmSma',
    group: 'land',
    label: 'BLM cross-check (private/unknown)',
    note: 'Second opinion on "not public" from BLM, not a parcel-level ownership record. Bundled for the southwest Idaho starter region only.',
  },
  {
    id: 'huntUnits',
    group: 'land',
    label: 'Hunting units',
    note: "Hunt units, management zones and hunt districts from each state's wildlife agency. Download your state under Downloads → Hunting units; it is stored on the device and keeps working offline. Tap a boundary line or unit number for the unit and the agency's regulations. For reference only: boundaries can be out of date or inaccurate — check your state's current hunting regulations and local laws before you hunt.",
    downloadsLink: 'Download hunting units for your state',
    legend: [{ color: HUNT_UNIT_COLOR, label: 'Unit boundary' }],
    attribution: 'State wildlife agencies',
  },

  // --- Roads & trails ---
  {
    id: 'osm',
    group: 'roads',
    label: 'Roads & trails (OSM)',
    note: 'OpenStreetMap roads, dirt tracks and trails with names, drawn over any base map (dashed = track/trail). Download whole states under Downloads → Ready-made, or pick an area there. Topo and Hybrid already have roads baked in.',
    attribution: '© OpenStreetMap contributors',
  },
  {
    id: 'mvum',
    group: 'roads',
    label: 'MVUM forest roads & trails',
    note: 'Green = passenger cars OK, orange = high-clearance, purple = OHV/motorcycle only. Dashed = seasonal. Loads automatically for the area you are viewing while online.',
    attribution: 'USFS MVUM',
  },
  {
    id: 'usfsTrails',
    group: 'roads',
    label: 'USFS trails',
    note: 'National Forest hiking, horse, bike and motorized trails from the same Forest Service data warehouse as MVUM — often more complete than OSM in remote areas. Tap a trail for its allowed uses. Loads automatically for the area you are viewing while online.',
    legend: [
      { color: TRAIL_CLASS_COLORS.nonmotorized, label: TRAIL_CLASS_LABELS.nonmotorized },
      { color: TRAIL_CLASS_COLORS.motorized, label: TRAIL_CLASS_LABELS.motorized },
    ],
    attribution: 'USFS',
  },

  // --- Water & terrain ---
  {
    id: 'shadedRelief',
    group: 'terrain',
    label: 'Shaded relief',
    note: 'Live USGS tiles only (coarser than the base map, no detail past z13) — hidden while using downloaded maps.',
    onlineOnly: true,
  },
  {
    id: 'slopeAngle',
    group: 'terrain',
    label: 'Slope angle',
    note: 'Steepness shading from USGS 3DEP elevation, for judging backcountry terrain. Flat and gentle ground is left clear; most avalanche slides start on 30–45°. Appears from about zoom 12.',
    onlineOnly: true,
    legend: SLOPE_CLASSES.map(({ color, label }) => ({ color, label })),
    attribution: 'USGS 3DEP',
  },
  {
    id: 'nhd',
    group: 'terrain',
    label: 'Water (NHD)',
    note: 'Streams, rivers, lakes and canals from the USGS National Hydrography Dataset, drawn independently of the base map — handy over satellite.',
    onlineOnly: true,
    attribution: 'USGS NHD',
  },
  {
    id: 'wetlands',
    group: 'terrain',
    label: 'Wetlands (NWI)',
    note: 'USFWS National Wetlands Inventory: wetland boundaries colored by type. The service only draws them from about zoom 13.',
    onlineOnly: true,
    attribution: 'USFWS NWI',
  },

  // --- Hazards & conditions ---
  {
    id: 'wildfire',
    group: 'hazards',
    label: 'Wildfire perimeters',
    note: 'Current fire perimeters from NIFC, refreshed every 5 minutes while this is on. With no signal it shows the last copy saved on the device, with its age on the tap card. Perimeters are approximate and can lag the fire — check InciWeb or local officials.',
    legend: [
      { color: WILDFIRE_COLOR, label: 'Wildfire / complex' },
      { color: PRESCRIBED_COLOR, label: 'Prescribed fire' },
    ],
    attribution: 'NIFC',
  },
  {
    id: 'radar',
    group: 'hazards',
    label: 'Weather radar',
    note: 'Live NOAA/NWS precipitation radar, reloaded every 5 minutes. Online only, and never saved for offline use — it is only meaningful right now.',
    onlineOnly: true,
    legend: [
      { color: '#4ade80', label: 'Light' },
      { color: '#facc15', label: 'Moderate' },
      { color: '#f97316', label: 'Heavy' },
      { color: '#dc2626', label: 'Severe / hail' },
    ],
    attribution: 'NOAA / National Weather Service',
  },
];

/** Overlays in one group, in display order. */
export function overlaysInGroup(group: OverlayGroupId): OverlayOption[] {
  return OVERLAYS.filter((overlay) => overlay.group === group);
}

/** Groups paired with their overlays, skipping empty ones. */
export function groupedOverlays(): { group: (typeof OVERLAY_GROUPS)[number]; overlays: OverlayOption[] }[] {
  return OVERLAY_GROUPS.map((group) => ({ group, overlays: overlaysInGroup(group.id) })).filter(
    (entry) => entry.overlays.length > 0
  );
}

/** The on-map credit line: always USGS (the base map), plus each visible overlay's source, once each. */
export function mapAttribution(visibility: Record<OverlayLayerId, boolean>): string {
  const credits = [USGS_ATTRIBUTION];
  for (const overlay of OVERLAYS) {
    if (overlay.attribution && visibility[overlay.id] && !credits.includes(overlay.attribution)) {
      credits.push(overlay.attribution);
    }
  }
  return credits.join(' · ');
}
