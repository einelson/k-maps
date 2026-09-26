> App name: **K-Maps**. This document is the original design spec the project was built from (working title "TrailPin" throughout) — kept verbatim as the reference for architecture, data sources, and the phased roadmap. See `README.md` for current build status against this spec.

# TrailPin (working title): Free Offline Outdoor Maps App

A React Native app in the spirit of onX / CalTopo / Gaia: offline topo + satellite + hybrid maps, unlimited pins, lines and areas, filters, and a public-vs-private land layer. **No subscription, no paywalled offline, all-free data.**

---

## 1. Goals and non-goals

**Goals**
- Fully offline after download: maps, land layer, and all your own data
- Unlimited pins, lines, and areas, organized by **folder, type, color, tag**
- Topo, satellite, and hybrid base maps
- Public land boundaries, with everything else shown as "likely private (inferred)"
- Download by region cell, with size estimates, resume, and delete
- Import/export GPX, KML, GeoJSON so you can bring data over from other apps

**Non-goals (v1)**
- Private parcel lines and landowner names (county data is messy and mostly licensed; see §6.5)
- Turn-by-turn navigation
- Accounts, cloud sync, social features
- Worldwide coverage (US-first, because the best free data is US federal)

---

## 2. Free data sources

| Layer | Source | License | Format |
|---|---|---|---|
| Topo (contours, hillshade, trails, roads) | USGS National Map `USGSTopo` | Public domain | Raster tiles |
| Satellite | USGS `USGSImageryOnly` (mostly NAIP, ~1 m, US) | Public domain | Raster tiles |
| Hybrid (imagery + topo linework) | USGS `USGSImageryTopo` | Public domain | Raster tiles |
| Shaded relief (optional) | USGS `USGSShadedReliefOnly` | Public domain | Raster tiles |
| Public land boundaries | USGS **PAD-US 4.1** | Public domain | GeoPackage / GeoJSON by state |
| Federal surface manager + private/unknown class (cross-check) | **BLM National SMA** | Public | ArcGIS service / GDB |
| Forest roads open to vehicles | USFS **MVUM** (Enterprise Data Warehouse) | Public | Shapefile / GDB |
| Roads, trails, water, place labels | **OpenStreetMap** via Protomaps basemap | ODbL (attribution required) | PMTiles |
| Elevation (later: slope shading) | Terrain-RGB tiles (e.g. Mapterhorn) or USGS 3DEP | Check per source | PMTiles / GeoTIFF |

### Notes per source

- **USGS tile services.** Base URL: `https://basemap.nationalmap.gov/arcgis/rest/services/<ServiceName>/MapServer`. The services are public-domain data, cached tile pyramids, Web Mercator. The topo cache goes to roughly zoom 16-17; check each service's tile info for its max level and overzoom past it. The imagery is mostly NAIP, so freshness varies by state and is often a few years old.
- **PAD-US 4.1.** National inventory of public and protected land, published by USGS. State downloads come as GeoPackage/GeoJSON, plus national GDB. The field that matters is **`Pub_Access`** (Open / Restricted / Closed / Unknown), along with owner/manager fields. It's a "best available" aggregation from many agencies, so quality varies by area.
- **BLM SMA.** Federal land classified by the managing agency (BLM, USFS, NPS, and so on). One BLM service variant includes *Private* and *Unknown* classes, which is useful as a second opinion on "not public". It covers federal and some state land, and is strongest in the West.
- **Protomaps basemap.** Daily-built OSM vector tiles in one PMTiles archive. The `pmtiles extract` CLI cuts out a bounding box, and `--maxzoom` trims size (each zoom level roughly doubles it). Attribution to OpenStreetMap must be visible on the map.
- **MVUM.** Adds "is this forest road legal for my vehicle" detail that OSM often lacks.

### Sources to avoid
- Google, Bing, and Esri World Imagery tiles (terms prohibit bulk offline caching)
- `tile.openstreetmap.org` (its usage policy prohibits bulk downloading; use Protomaps builds instead)

---

## 3. Architecture

```
┌──────────────────────── React Native app (Expo dev build, TypeScript) ───────────────────────┐
│                                                                                                │
│  UI (React Navigation)        State (Zustand)          Map (@maplibre/maplibre-react-native)   │
│  ├─ Map screen                ├─ layer visibility      ├─ base raster source (local MBTiles)   │
│  ├─ Layers sheet              ├─ filter state          ├─ land vector source (local MBTiles)   │
│  ├─ Downloads screen          ├─ active draw tool       ├─ OSM vector source (local MBTiles)    │
│  ├─ Items list / editor       └─ download queue        └─ user data GeoJSON source             │
│  └─ Import / Export                                                                            │
│                                                                                                │
│  Storage                                                                                       │
│  ├─ SQLite (expo-sqlite): folders, features, tags, coverage, settings                          │
│  └─ File system: /maps/<layer>/…mbtiles, /photos/…                                             │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
        ▲                                        ▲
        │ raster tiles fetched directly          │ prebuilt vector packs (land, OSM)
        │ from USGS into local MBTiles           │ from static hosting you control
   basemap.nationalmap.gov                  GitHub Releases / Cloudflare R2 / sideload
```

**Key choices**

| Decision | Choice | Why |
|---|---|---|
| Map engine | MapLibre React Native | Free, native performance, style spec, reads local MBTiles |
| Offline storage | Own downloader writing **MBTiles** | Full control over size, resume, and cell deletion (see §3.1) |
| User data | SQLite + GeoJSON in memory | Unlimited items, fast queries, easy import/export |
| Vector tile format on device | **MBTiles** (convert PMTiles → MBTiles) | MapLibre Native reads MBTiles directly; PMTiles offline support is not there |
| Hosting | Only for vector packs (land + OSM) | Raster comes straight from USGS, so no cost |
| Expo | Dev build (not Expo Go) | Native map module needed |

### 3.1 Why not MapLibre's built-in offline packs?
They work and are simplest for small areas, but:
- Default cap is **6,000 tiles** per device (adjustable, but it shows the design is aimed at small regions). One z10 cell at zoom 16 is already ~5,500 tiles.
- PMTiles sources aren't supported for offline packs.
- Less control over resume, per-cell deletion, and size estimates.

A custom downloader plus MBTiles is more work but is the right fit for "download my whole hunting unit at high zoom".

---

## 4. Offline download system ("Map Cells")

### 4.1 Cell grid
Use **XYZ zoom-10 tiles as download cells**. At Idaho's latitude each cell is about **28 × 28 km**. Cells are tile-aligned, so every child tile at any zoom maps cleanly to exactly one cell.

```ts
// All child tiles of a z10 cell at zoom z (z >= 10)
function childTiles(cx: number, cy: number, z: number) {
  const n = 1 << (z - 10);
  const tiles: { z: number; x: number; y: number }[] = [];
  for (let dx = 0; dx < n; dx++)
    for (let dy = 0; dy < n; dy++)
      tiles.push({ z, x: cx * n + dx, y: cy * n + dy });
  return tiles;
}
// MBTiles uses TMS row order: flip y before storing
const tmsY = (z: number, y: number) => (1 << z) - 1 - y;
```

### 4.2 Rough size per cell (estimates, measure in the spike)

| Max zoom | Tiles per cell | Imagery (~20-35 KB) | Topo (~10-25 KB) |
|---|---|---|---|
| z14 | ~341 | ~10 MB | ~6 MB |
| z15 | ~1,365 | ~40 MB | ~25 MB |
| z16 | ~5,461 | ~110-190 MB | ~55-135 MB |
| z17 | ~21,845 | ~450-750 MB | ~220-550 MB |

Each extra zoom level is **4x**. Default recommendation: **z16 for imagery, z16 for topo**, with z12 for the overview levels of everything.

### 4.3 Download UX
1. Downloads screen shows the grid over the map. Tap cells, or drag a rectangle, to select.
2. Pick layers: Topo, Satellite, Hybrid, Land, OSM roads/trails.
3. Pick max zoom (default z16). App shows **estimated size** and **free space**.
4. Queue starts. Per-cell states: `not downloaded → queued → downloading → complete | partial | failed`.
5. Actions per cell: pause, resume, delete, update.
6. Storage screen: size by layer and by cell, "delete all satellite", etc.

**As built.** Downloads is three tabs (Pick an area / Ready-made / On this phone). Instead of dragging a
rectangle, a tap picks a *block* of cells whose side doubles as the map zooms out (1, 2, 4, 8, 16 cells; always
roughly a finger's width on screen), aligned to the grid so blocks tile exactly (`src/downloads/blockSelect.ts`),
plus "pick everything in view", with a cap of 500 cells per download. The plan skips anything already complete
(`src/downloads/downloadPlan.ts`), the footer totals size and time and blocks a download that doesn't fit in free
space, and progress lives in a store (`src/state/useDownloadRunStore.ts`) so it outlives the screen. Not built:
pause/resume, per-cell delete for raster tiles, concurrent fetching (cells run one at a time).

### 4.4 Downloader behavior
- Concurrency 4-6 requests, exponential backoff, and a descriptive `User-Agent`. **Be gentle**: these are shared public servers.
- Resumable: the coverage table records which `(layer, z, x, y)` are done, so restart skips them.
- Skip blank/duplicate tiles where the server returns tiny "no data" images.
- Insert in transactions of ~200 tiles.
- Keep the screen awake during a foreground download. Background downloads are unreliable on iOS, so design for foreground plus resume.
- On completion, mark the cell complete in the app DB.

### 4.5 Storage layout (decision to validate in the spike)

**Option A (preferred): one MBTiles per layer, append-only**
`/maps/topo.mbtiles`, `/maps/imagery.mbtiles`, `/maps/hybrid.mbtiles`. One source per layer, so adjacent cells render seamlessly.
Risk: MapLibre may have the file open while the downloader writes. Mitigate with WAL mode, or write into a staging file and merge when the map is idle.

**Option B: one MBTiles per cell per layer**
Immutable once complete, trivial to delete. Risk: MapLibre takes **one MBTiles per source**, so many cells means many sources.

**Option C: loose files**
`file:///…/imagery/{z}/{x}/{y}.jpg` via `tileUrlTemplates`. Simple, no SQLite locking. Cost: thousands of small files and slower bulk deletes.

### 4.6 Rendering a local raster pack
```tsx
// Component names differ between MapLibre RN versions. Check the docs for yours.
<RasterSource
  id="imagery"
  tileUrlTemplates={[`mbtiles:///${FileSystem.documentDirectory}maps/imagery.mbtiles`]}
  tileSize={256}          // USGS tiles are 256px; a wrong value renders mixed sharp/blurry tiles
  minZoomLevel={0}
  maxZoomLevel={16}
>
  <RasterLayer id="imagery-layer" sourceID="imagery" />
</RasterSource>
```
Path format for `mbtiles://` differs between iOS and Android in community reports. Test both.

---

## 5. Map layers and styling

### 5.1 Layer stack (bottom to top)

1. **Base** (pick one): Topo, Satellite, Hybrid, or OSM vector (light/outdoor style)
2. Optional shaded relief (transparent overlay on satellite)
3. **Land**: public land fills + outlines
4. Optional: MVUM roads, BLM SMA cross-check
5. **Your data**: areas, lines, points, labels
6. **GPS dot** and heading

### 5.2 Base map modes

| Mode | Built from | Notes |
|---|---|---|
| Topo | USGS Topo raster | Contours, hillshade, trails, roads baked in |
| Satellite | USGS Imagery raster | ~1 m NAIP, US only |
| Hybrid | USGS Imagery Topo raster (ready-made), **or** Imagery + OSM vector labels/roads overlay | The overlay approach lets you toggle roads, trails and labels independently |

### 5.3 Layer sheet UI
- Toggle + opacity slider per layer (Land opacity is the one you'll use most)
- Base-map switcher at the top
- Legend for land colors
- "Reset" and named **saved views** (for example "Hunt: elk unit" = satellite + land + orange pins only)

---

## 6. Public vs private land

### 6.1 The approach
Show **public land explicitly** and treat everything else as **"not in public-land data, likely private (inferred)"**. This is honest about what the data can support and gets most of the practical value.

### 6.2 Build pipeline (laptop, once per state or data release)
```bash
# 1. Download the state file from the PAD-US 4.1 data page (GeoPackage or GDB)
# 2. Inspect layers and fields
ogrinfo PADUS4_1_State_ID.gpkg

# 3. Export to line-delimited GeoJSON in WGS84 with only the fields you need
ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 pad_id.geojsonl PADUS4_1_State_ID.gpkg <layer_name> \
  -select "Pub_Access,Own_Type,Own_Name,Mang_Type,Mang_Name,Unit_Nm,Des_Tp,GAP_Sts"

# 4. Build vector tiles
tippecanoe -o land_id.mbtiles -l public_land -Z4 -z14 \
  --drop-densest-as-needed --coalesce-densest-as-needed pad_id.geojsonl
```
Do the same per state you care about (start with one). Field names come from the PAD-US data manual, so confirm them with `ogrinfo` on your download.

For OSM roads, trails, and labels:
```bash
pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles id.pmtiles \
  --bbox=<minLon,minLat,maxLon,maxLat> --maxzoom=15
pmtiles convert id.pmtiles id_osm.mbtiles   # confirm your CLI version supports this; otherwise build MBTiles with Planetiler
```

### 6.3 Styling rules

| Class | Rule | Look |
|---|---|---|
| Public, open | `Pub_Access = Open` | Green fill 25%, solid outline |
| Public, restricted | `Restricted` | Amber fill 25%, dashed outline |
| Public, closed | `Closed` | Red hatch or light red fill |
| Public, unknown access | `Unknown` | Blue-gray fill |
| **Everything else** | No polygon | No fill, described in legend as "likely private (inferred)" |

Optional recolor by **manager** (BLM, USFS, NPS, State, and so on) on a legend toggle, since many people think in agency colors.

Tap a polygon to see: unit name, manager, owner type, access status, designation, and the **data source and vintage**.

### 6.4 Optional: draw "likely private" explicitly
Map styles can't subtract polygons at render time. If you want a shaded private tint:
1. At build time, compute `state boundary minus union(public polygons)` with GDAL/PostGIS.
2. Tile it as a second layer (`likely_private`).

Defer this to Phase 5. The unshaded default already works well.

### 6.5 Honest limits
- **Public ownership does not equal legal access.** Landlocked parcels, seasonal closures, permit-only state trust land, and easements exist. `Pub_Access` helps but is imperfect.
- **Absence of a public polygon does not prove private.** It can be tribal, local government, missing data, or an agency that reports late.
- Boundaries can be off by tens of meters at high zoom. Show a persistent "for planning only, verify on the ground" note.
- Real parcel lines and owner names are county-level data. Aggregators sell it under licenses that restrict offline caching, so v1 doesn't include it. Some counties publish open parcel data, so a future "add my county's parcel file" import is possible.

---

## 7. Pins, lines, and areas

### 7.1 Data model (SQLite)
```sql
CREATE TABLE folders (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  parent_id INTEGER REFERENCES folders(id),
  visible INTEGER DEFAULT 1,
  sort INTEGER DEFAULT 0
);

CREATE TABLE features (
  id INTEGER PRIMARY KEY,
  folder_id INTEGER REFERENCES folders(id),
  type TEXT NOT NULL CHECK (type IN ('point','line','polygon')),
  name TEXT,
  notes TEXT,
  color TEXT,                 -- hex from a fixed palette of ~12
  icon TEXT,                  -- e.g. 'camp','water','stand','trailhead'
  geometry TEXT NOT NULL,     -- GeoJSON geometry
  min_lon REAL, min_lat REAL, max_lon REAL, max_lat REAL,
  length_m REAL, area_m2 REAL, elevation_m REAL,
  source TEXT DEFAULT 'manual',  -- manual | imported | track
  created_at INTEGER, updated_at INTEGER
);

CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT);
CREATE TABLE feature_tags (
  feature_id INTEGER REFERENCES features(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (feature_id, tag_id)
);

CREATE TABLE photos (id INTEGER PRIMARY KEY, feature_id INTEGER REFERENCES features(id) ON DELETE CASCADE, path TEXT);

-- The recording in progress (single row) and its fixes, written by the background location task:
CREATE TABLE recording_session (id INTEGER PRIMARY KEY CHECK (id = 1), started_at INTEGER NOT NULL);
CREATE TABLE recording_fixes (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, lon REAL NOT NULL, lat REAL NOT NULL, altitude REAL);

-- Recorded/imported tracks: per-point time and altitude, index-aligned with the line's coordinates
-- (JSON: {"t": [epoch ms]|null, "e": [metres|null]|null}). Kept out of `geometry` so the line stays [lon, lat].
CREATE TABLE track_data (feature_id INTEGER PRIMARY KEY REFERENCES features(id) ON DELETE CASCADE, data TEXT NOT NULL);

-- Offline coverage
CREATE TABLE coverage (
  layer TEXT, cell_x INTEGER, cell_y INTEGER,
  max_zoom INTEGER, status TEXT, bytes INTEGER, updated_at INTEGER,
  PRIMARY KEY (layer, cell_x, cell_y)
);

-- Search (add R*Tree on bbox for viewport queries if lists get large)
CREATE VIRTUAL TABLE features_fts USING fts5(name, notes, content='features', content_rowid='id');
```

### 7.2 Filters: folder, type, color, tag
Filter state:
```ts
type Filters = {
  folderIds: number[] | null;      // null = all
  types: ('point'|'line'|'polygon')[] | null;
  colors: string[] | null;
  tagIds: number[] | null;
  tagMode: 'any' | 'all';
  text?: string;
};
```

Two mechanisms:
- **Map visibility (instant): MapLibre filter expressions.** Load all items into one GeoJSON source with `folder_id`, `type`, `color`, and `tag_ids` (array) as properties, then set the layer filter, so toggling never round-trips to SQLite.
```ts
const filter = ['all',
  ['in', ['get', 'folder_id'], ['literal', folderIds]],
  ['in', ['get', 'type'], ['literal', types]],
  ['in', ['get', 'color'], ['literal', colors]],
  // tagMode 'any':
  ['any', ...tagIds.map(id => ['in', id, ['get', 'tag_ids']])],
];
```
- **Lists and search: SQL** (`WHERE folder_id IN (...) AND type IN (...)`, plus FTS for text).

Filter UI: chip bar above the map (Folders / Types / Colors / Tags), a badge showing the active-filter count, and **saved filter presets**.

Performance: enable clustering for points at low zoom. Thousands of items is fine; tens of thousands, load by viewport bbox.

### 7.3 Drawing and editing
- **Point:** long-press or crosshair "drop pin at center" plus "drop at my location"
- **Line:** tap to add vertices, drag to move, undo, live length readout
- **Area:** tap vertices, live area and perimeter readout
- **Edit:** select feature, drag vertices, delete vertex, change folder/color/tags/notes
- **Measure tool** without saving
- Use **Turf.js** for length, area, and bbox
- Coordinates display: decimal degrees, DMS, UTM, and a copy button

### 7.4 Import / export
- Import GPX (waypoints, routes, tracks), KML/KMZ, GeoJSON; map GPX/KML folders to app folders
- Export by folder or by current filter
- Full backup: zip of the DB + photos, shareable to Files/Drive/AirDrop
- Sync later, if wanted: the user's own cloud folder, so no server is needed

### 7.5 GPS tracks (Phase 5)
Record a breadcrumb line with `expo-location`, save as a `line` with `source='track'`, and keep each fix's time and altitude in `track_data`.

Recording runs in the background (screen locked, app closed) as an `expo-location` task under an Android foreground service with a visible notification. The task appends each fix to SQLite (`recording_session`, `recording_fixes`) so nothing depends on the app's JS being alive; the app mirrors that table into memory while open and saves the track from it. Started while the app is on screen, the service needs only the ordinary location permission (no "Allow all the time"); it needs `FOREGROUND_SERVICE_LOCATION` on Android 14+ and, to show the notification on Android 13+, `POST_NOTIFICATIONS`.

On iOS the same task runs under the `location` background mode (`UIBackgroundModes`, via the expo-location plugin's `isIosBackgroundLocationEnabled`) with the blue status-bar indicator; "While Using" permission is enough to keep recording while backgrounded or locked, and "Always" (offered once recording has started) additionally lets the system relaunch a terminated app. A force-quit app is never relaunched, so a swipe-away ends the recording there; reopening restores the stored fixes, restarts updates and notes the gap.

While recording, a map button shows elapsed time and distance and opens a panel: live stats and charts, Delete, and End & save.

Tapping a track opens its dashboard: distance, elapsed and moving time, average speed, climb/descent/high/low point, an elevation chart (against time or distance) and a distance-over-time chart, plus the usual name/folder/color/tags and a GPX export that carries `<time>` and `<ele>`. Imported GPX tracks that have timestamps or elevation get the same dashboard.

---

## 8. Screens

1. **Map**: base map, layers button, filter chips, draw toolbar, GPS button, compass, scale bar, coordinate readout
2. **Layers sheet**: base map switcher, overlay toggles + opacity, land legend, saved views
3. **Downloads**: three tabs — pick an area (cell grid with zoom-scaled block selection, layer and detail picker, size estimate, progress), ready-made regions and hunting units, and a storage manager
4. **Items**: list by folder, search, multi-select (move, recolor, tag, delete, export)
5. **Feature detail/editor**: name, notes, photos, folder, color, icon, tags, coordinates
6. **Import/Export and backup**
7. **Settings**: units (imperial/metric), coordinate format, appearance (system/light/dark), default zoom limits, attribution and data-vintage info

**What is remembered between launches.** Every store that holds a choice the user made is saved to expo-sqlite's
key-value store as it changes (synchronous, so it is in place before the first render) and restored by a `merge`
that fills in anything a newer version added and discards anything unreadable (`src/state/persistHelpers.ts`):
layers (`kmaps.layers`), filters and filter presets (`kmaps.filters`, without the Items search text), POI toggles
(`kmaps.poi`), saved views (`kmaps.savedViews`), download choices (`kmaps.downloadOptions`, not the picked cells),
the main map's camera (`kmaps.camera`), settings (`kmaps.settings`), hunting-unit installs and acceptances, and
region-pack installs. Deliberately not saved: the location dot (it needs this session's permission), a recording
in progress (SQLite already holds that) and anything transient (draw tool, selection, download progress).

---

## 9. Suggested project structure

```
/src
  /map          MapView, layer components, style builders, filters → expressions
  /downloads    cell math, downloader, MBTiles writer, coverage
  /data         SQLite schema, migrations, repositories, import/export
  /features     draw tools, editors, measurement
  /screens
  /state        Zustand stores
/tools          laptop scripts: PAD-US → MBTiles, OSM extract, pack manifest
/packs          region pack build output (git-ignored) — see packs/README.md
```

**Region packs (as built).** The overlay layers render from per-cell GeoJSON files, not MBTiles, so the
hosted packs are zips of those cell files rather than the `land_*.mbtiles` sketched in the original design.
`tools/build_region_pack.mjs` builds `<region>-<layer>.zip` for `land`, `mvum` and `trails` plus a
`manifest.json`, published to a rolling `data` GitHub release; the app installs them from Downloads
(`src/downloads/regionPackInstaller.ts`). Manifest (`src/packs/regionPacks.ts`, `format` bumps on any
incompatible change):
```json
{
  "format": 1,
  "regions": [
    { "id": "idaho", "name": "Idaho", "cells": [[179, 351], [180, 351]],
      "packs": [{ "layer": "land", "file": "idaho-land.zip", "bytes": 14921439, "version": "2026-09-25T00:12:49.148Z" }] }
  ]
}
```
**US only, all 50 states (as built).** K-Maps is a US app, so nothing is drawn or fetched for anywhere else.
`assets/us/us-cells.json` (built by `tools/build_us_outline.mjs` from Census 1:500,000 state boundaries) marks each z10
cell wholly inside, wholly outside, or on a coast/border of the US, with the US part of edge cells; the pack fetchers
take it in their context (`PackContext.us`, `src/packs/usCoverage.ts`, `usFilter.ts`): outside cells are skipped, the
"likely private" inference starts from US land instead of the whole cell rectangle, and edge-cell OSM lines/POI points
outside the US are dropped. Each state's cells come from the same data (`assets/us/us-state-cells.json`), so a state
is exactly the cells its outline touches. Land, MVUM and trails are fetched per cell (`tools/build_all_states.sh`);
OSM roads and POI pins come from Geofabrik state extracts (`tools/osm_cells.py`, `tools/finalize_osm_cells.mjs`)
because Overpass takes minutes per cell. Manifest format 2 lets a layer be split into ~40 MB parts, each listing its
cells (`RegionPackFile.cells`), because the app unzips a pack in memory.

**Hunting units (as built).** Every state agency's hunt units / management zones are downloaded as one small zip per
state (`hunt-<st>.zip`, a single normalized GeoJSON `units.json`), listed under `huntUnits` in the same manifest with
each state's bounding box, unit sets (species) and source agency. Every state, Idaho included, installs from
Downloads and is drawn from a local `file://` GeoJSON source, so they work offline. Only states overlapping the view
are mounted (`src/map/huntUnitWindow.ts`). Sources and per-state column mappings: `src/huntUnits/registry.ts`.

Because a region installs hundreds of cells and each mounted cell is a MapLibre source plus style layers,
the map only mounts cells near the view (`src/map/cellWindow.ts`). If that proves too limiting (no
low-zoom overview), the next step is one MBTiles vector-tile pack per region and layer, as this section
originally proposed.

---

## 10. Roadmap

| Phase | Deliverable | Rough effort (part-time solo) |
|---|---|---|
| **0. Spike** | Answer the risks in §12: read MBTiles while writing; one z10 cell of USGS topo downloaded and rendered offline on iOS and Android; PAD-US → MBTiles for one state rendered | 2-4 days |
| **1. Core map** | MapLibre + online USGS topo, GPS dot, points/lines/areas in SQLite, folders | 1-2 weeks |
| **2. Offline downloads** | Cell grid, downloader, MBTiles rendering, size estimates, storage screen | 1-2 weeks |
| **3. Land layer** | Pack pipeline, hosted pack download, styling, tap-for-details | ~1 week |
| **4. Organization** | Colors, tags, filters, saved views, search, GPX/KML/GeoJSON import/export, backup | ~1 week |
| **5. Polish** | Satellite + hybrid modes, MVUM overlay, GPS tracks, measure tool, likely-private layer | 1-2 weeks |
| **Later** | Slope-angle shading, county parcel import, multiple states, Android/iOS widgets, cloud-folder sync | open |

Suggested first region: your home area in southwest Idaho, where BLM/USFS-to-private boundaries are frequent, so public/private contrast is easy to test.

---

## 11. Licensing and attribution checklist

- **USGS data:** public domain. Credit "USGS The National Map" in an About/Data screen.
- **PAD-US:** public domain. Credit USGS GAP. Show the data version (4.1) in the land tap card.
- **OpenStreetMap / Protomaps tiles:** ODbL. Show "© OpenStreetMap" on the map surface.
- **BLM SMA, MVUM:** federal public data. Confirm current terms on the dataset pages.
- **App disclaimer** (first run and About): map data may be out of date or incorrect; verify land status and access before relying on it; not for navigation in emergencies.

---

## 12. Risks and open questions

1. **MBTiles concurrency:** can MapLibre read a file that the downloader is writing? Decides §4.5 Option A vs B vs C. *Spike first.*
2. **USGS tile server load:** I did not find explicit bulk-caching terms for the tile services. Keep concurrency low with backoff. If you ever publish this app widely, mirror your own packs or use USGS's bulk imagery downloads instead of scraping tiles. Check current terms first.
3. **Max native zoom per USGS service:** verify each service's tile info and set `maxZoomLevel` and overzoom accordingly.
4. **`mbtiles://` path handling** differs between iOS and Android; test both early.
5. **Background downloads on iOS** are limited. Plan foreground + resume, with a "keep app open" prompt.
6. **Storage pressure:** satellite at z16 is ~110-190 MB per 28 km cell. Make sizes visible before download.
7. **Data quality:** PAD-US is an aggregate with uneven quality; keep the "verify on the ground" language visible.
8. **MapLibre RN version differences:** component names and props changed across major versions. Pin a version and follow its docs.
9. **Hosting vector packs:** GitHub Releases or a Cloudflare R2 bucket should cost little or nothing at personal scale. Verify current free-tier limits before relying on either.

---

## 13. Phase 0 spike checklist

- [ ] New Expo dev build with `@maplibre/maplibre-react-native`
- [ ] Render live USGS topo raster (online) with correct `tileSize`
- [ ] Script: download one z10 cell of topo to z14 into an MBTiles file; render it in airplane mode
- [ ] Repeat for imagery at z16; record actual MB
- [ ] Write tiles to MBTiles while the map is displaying it; confirm no crash or blank tiles
- [ ] Run the PAD-US pipeline for one state; render `public_land` from local MBTiles with Pub_Access styling
- [ ] Load 10,000 fake pins with a filter expression toggle; confirm smooth performance
- [ ] Test the same build on one iOS and one Android device
