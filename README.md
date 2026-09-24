# K-Maps

Free, offline-first outdoor maps for iOS and Android — topo, satellite, and hybrid basemaps,
unlimited pins/lines/areas, and a public-vs-private land layer. No subscription, no paywalled
offline mode, all-free data (USGS, PAD-US, OpenStreetMap).

Full design spec, data sources, architecture, and phased roadmap: **[docs/SPEC.md](docs/SPEC.md)**.

## Status

All screens and data flows from the spec are wired up. The app has been launched on a real
Android device (Galaxy S21, Android 15): the map, USGS topo tiles, chrome, SQLite and the bundled
label fonts all load. Typecheck and lint are clean, and `npm test` runs ~700 unit tests over the
pure logic (cell math, coordinates, filters, GPX/KML/GeoJSON, stores, pack fetch/clip pipeline,
the live-overlay URL builders, wildfire cache/refresh, and the as-you-pan loader).
**Still not verified on a device:** the newer features below (vertex dragging, the new-pin card
and pin styles, the base-map switch fix, zoom-to-my-location,
clustering, labels, photo capture, on-device cell downloads, offline `mbtiles://` rendering, and
the hazard/water/terrain layers and as-you-pan loading described below) — they typecheck and
their logic is unit-tested, but they haven't been exercised by hand yet. The live overlay
endpoints were each probed over the network and return real tiles through this app's own URL
builders, and the Android MapLibre binary is confirmed to support the `{bbox-epsg-3857}` tile
token they rely on; what's untested is how they look and behave on the phone.

**Working (as far as static analysis can confirm):**

- Expo (TypeScript) app with React Navigation, MapLibre v11, Zustand, expo-sqlite
- Live online basemap (USGS Topo/Satellite/Hybrid) with base-map switching (one raster source per
  base map, only the selected one's layer visible — a raster source's `tiles` are fixed when it's
  created, so swapping the URL on one source never actually switched maps), plus an "offline"
  toggle that renders from a downloaded MBTiles file via MapLibre Native's `mbtiles://` scheme
  instead of live tiles (§4.6) — the scheme itself is confirmed to exist upstream, but this app's
  exact path handling is unverified (§12.4)
- **Land, MVUM, USFS trails, POI and OSM data work anywhere in the US.** Downloads → *Overlay
  data* fetches each selected cell straight from the public services on the device (PAD-US, USFS
  MVUM and trails, Overpass) and stores one JSON file per cell; the map draws them via MapLibre
  `file://` GeoJSON sources. The southwest Idaho starter region (30 cells) is still bundled so
  first launch isn't empty. Cell-aligned, so downloaded cells never overlap it, and outlines are
  stripped along cell edges so there are no artificial grid lines
- **Land coverage grows as you pan.** The bundled starter region used to be the only place public
  land showed. Now, while online, the main map fetches public land (+ likely-private shading),
  MVUM and USFS trails for the z10 cells in view (from zoom 10 in, nearest cells first, at most 12
  per view, one at a time, only for overlays that are switched on) and keeps them on the device,
  so anywhere you've looked works offline later. After two failures in a row it assumes there's no
  signal and pauses for two minutes; a failed cell isn't retried for five. A small "Loading map
  data…" chip shows progress. Switch it off with Layers → *Load land data as I pan*. OSM and POI
  stay manual — the free Overpass servers are too slow to fetch behind your back
- **Layers are sorted into groups** — *Land & access*, *Roads & trails*, *Water & terrain*,
  *Hazards & conditions* — in both the map's quick dropdown (groups fold away; one opens with any
  layer that's on and shows an "N on" badge) and the full Layers screen (legends, opacity,
  "online" tags). Points of interest keep their own section
- **Hazards & conditions.** *Wildfire perimeters* (NIFC WFIGS interagency feed) are refreshed every
  5 minutes while the layer is on and whenever the app returns to the foreground, cached on the
  device as the "last known" state for offline (the tap card shows its age), with fire name,
  acres, containment, discovery date and cause on tap; prescribed burns are amber. The service
  URL originally suggested (`Public_Wildfire_Perimeters_View`) now demands an ArcGIS token, so
  this uses `WFIGS_Interagency_Perimeters_Current`, the open sibling in the same org with the same
  5-minute cache. *Weather radar* is the live NOAA/NWS MRMS mosaic, reloaded every 5 minutes,
  online-only and never saved
- **Water & terrain.** *Water (NHD)* is USGS's cached hydrography tiles and *Wetlands (NWI)* the
  USFWS map service (drawn from about zoom 13, where the service starts drawing) — both are
  rasters drawn by the services, so they work over any base map but aren't restyleable or
  tappable, and unlike the spec's vector idea aren't available offline. *Slope angle* is computed
  live by USGS 3DEP (`Slope Degrees`, which I checked against a from-scratch calculation to make
  sure it isn't distorted by Web Mercator) and colored yellow / orange / red / purple for
  27–30 / 30–35 / 35–45 / 45°+, transparent below 27°; from about zoom 12
- **Land managers (BLM SMA)** is BLM's cached national tiles colored by managing agency (BLM, Forest
  Service, Park Service, Fish & Wildlife, state, ...) for the whole US — separate from PAD-US and
  from the private/unknown cross-check below
- **USFS trails** (National Forest System trails from the same Enterprise Data Warehouse as MVUM):
  hiking/horse/bike trails teal, motorized magenta, dashed; tap for allowed uses, surface and tread
  width. A per-cell pack like MVUM, so it works offline once loaded
- **Idaho hunting units** (IDFG Game Management Units) bundled statewide (100 polygons, 1.3 MB;
  `tools/fetch_idfg_units.mjs`): dashed boundaries with unit numbers, tap for the unit, elk zone and
  IDFG deer/elk pages. Outline-only on purpose — MapLibre gives a tap to the topmost source, so a
  fill would block taps on the land polygons beneath. IDFG calls the data a "best representation
  only": the layer and its card say to confirm boundaries in the regulation booklet
- **"Likely private" shading (§6.4):** each land cell also carries the inferred complement — cell
  rectangle minus the union of public polygons, slivers dropped — drawn as a purple tint with a
  tap card explaining it's an inference, not a parcel record
- **Roads & trails (OSM) overlay:** downloaded OSM highways/tracks/paths, styled by class (dashed
  tracks/trails), with names along the lines. Toggle in Layers
- Public land layer: real PAD-US data — federal agencies via a USDOT ArcGIS mirror, plus state,
  local and special-district land from USGS's PAD-US 4.1 feature service (state land is a big
  share of Idaho and would otherwise render as "likely private") — styled by `Pub_Access` per
  §6.3, tap-for-details card. Private/NGO conservation land is excluded and tribal land isn't
  covered. Plus a BLM "private/unknown" cross-check overlay (§2) — both fetched for one starter
  bbox by `tools/fetch_land.mjs` / `tools/fetch_blm_sma.mjs` and bundled as static assets, not
  the full state-GDB pipeline in `tools/pad_us_to_mbtiles.sh`
- MVUM forest roads/motorized trails overlay (USFS Enterprise Data Warehouse, same starter bbox,
  `tools/fetch_mvum.mjs`), colored by drivability: green = passenger cars (maintenance level 3+),
  orange = high-clearance (level 2), purple = OHV/motorcycle trails. Tap card shows the MVUM
  designation; seasonal roads/trails are drawn dashed
- Pre-built POI pins for boat launches and campsites/trailheads (not in the original spec — added
  by request), pulled from real OSM data via Overpass (`tools/fetch_pois.mjs`), with independent
  show/hide toggles and a tap card with a "Get Directions" button that hands off to the phone's
  own maps app (`geo:` intent on Android, Apple Maps on iOS). Same Directions button on point
  features in the item editor
- Your saved pins, lines and areas render on the map (colored, tap to open the item) and respect
  the folder/type/color/tag filters through a MapLibre filter expression, so toggling is instant
  and never round-trips to SQLite (§7.2). The filter button (top left of the map) expands into a
  chip bar that opens per-category filter sheets and saved filter presets. No text labels on them — that would need a glyph/font server, which
  an offline-first app doesn't have; the name shows on tap
- Map-screen layout: the map sits above a docked bottom toolbar (My Content, Downloads,
  Import/Export, Settings) and stops above the Android navigation bar rather than drawing under
  it. A round "+" button (bottom right) opens Point / Line / Area / Measure / Record track; a
  layers button (top right) drops down the base-map picker and overlay toggles (public land etc.)
  with a link to the full Layers screen; the locate button sits beneath it (tap: ask for
  permission, show the position marker and zoom to it; long-press: hide the marker)
- Dropping a pin (long-press the map, or "+" → Point) opens a card from the bottom to set name,
  description, color, pin style and tags before it's saved; the pin previews live on the map.
  Pins are colored teardrop markers with a glyph (pin, camp, water, stand, trailhead, peak, star,
  flag, hazard), so they never read as the round blue location dot. The artwork is generated by
  `node tools/build_pin_icons.mjs` (signed-distance PNGs in `assets/pins/`); the style can also be
  changed later in the item editor
- Map-screen chrome (§8.1): native compass and scale bar, a center crosshair with a live
  coordinate readout (tap to cycle DD → DMS → UTM, Copy button), and the Settings coordinate
  format now applies everywhere coordinates are shown
- Light / dark mode: Settings → Appearance (System, Light, Dark; saved across launches, as are
  units and the coordinate format). Colors come from semantic roles in `src/theme/colors.ts`;
  screens build their styles with `useThemedStyles`, and use `Text`/`TextInput` from
  `src/theme` (not `react-native`'s, which are black in every theme). Map tiles and pin/feature
  colors stay as they are. The app draws edge-to-edge on Android, so scrolling screens, bottom
  sheets and the toolbar pad for the navigation bar, and the new-pin card lifts above the keyboard
  using the nav-bar inset rather than trusting RN's keyboard `screenY`. Changing
  `userInterfaceStyle` (and adding `expo-system-ui`) needs a native rebuild, not just a reload
- Shaded relief overlay (USGS, live tiles only — real tiles stop at z13, probed against the live
  service). While an overlay tap card would compete with placing a point or picking a download
  cell, those taps are routed to the draw/cell tool instead
- Drawing points/lines/areas end-to-end: tap-to-place points, multi-vertex lines/areas with live
  length/area readout, undo/cancel/done, saved to SQLite on completion; a separate measure tool
  that never saves (§7.3)
- GPS dot toggle and foreground-only GPS track recording, saved as a line feature with
  `source='track'` on stop (§7.5) — background recording is explicitly out of scope, same call
  the spec makes
- Folders, tags (create/assign/remove/filter), multi-select in Items (move/recolor/tag/delete/
  export), saved views capturing base map + overlays + POI toggles + filter (§5.3)
- Real GPX/KML/GeoJSON export and import (hand-rolled XML, `fast-xml-parser` for reading), a
  dedicated "export pins (points only)" action, export by folder or current filter, and a full
  DB+photos zip backup via the OS share sheet (§7.4)
- Cell math (`childTiles`, `tmsY`, cell↔lon/lat), an MBTiles writer, and a concurrency-limited
  downloader with resume (§4) — writes real files, but see the device-testing caveat above. The
  Downloads map now draws the cell grid state (selected / downloaded / partial), and max zoom is
  capped at z16 because USGS returns 404 for every tile past it (§12.3, probed)
- Laptop-side pipeline scripts: PAD-US/BLM/OSM-POI fetch-and-clip (`tools/fetch_*.mjs`, hit real
  APIs), plus the original full-pipeline scripts for PAD-US GDB → MBTiles and Protomaps → MBTiles
  (`tools/pad_us_to_mbtiles.sh`, `tools/osm_extract.sh`)

**Not implemented / known gaps:**

- BLM "private/unknown" cross-check is bundled for the starter region only (not downloadable)
- OSM roads & trails (and POI pins) are per-cell manual downloads — nothing is pre-loaded outside
  the starter region, and a dense city cell of OSM can be large
- Radar, NHD, NWI, slope angle and land managers are online-only rasters: nothing to download, no
  offline copy, no tap-to-identify. The spec's true-vector NHD/NWI (`ogr2ogr` → `tippecanoe`) and a
  build-time slope raster (`gdaldem slope`) would fix that but need a hosted tile pack
- Hunting units cover Idaho only; other states' units would each be another bundled asset
- As-you-pan loading covers land, MVUM and USFS trails only, and only in the main map (not the
  Downloads screen's), from zoom 10
- Photos store an absolute file URI; if the app's documents path ever changes they'd show "Missing"
- Point clustering only applies to your saved points, not the POI pins
- Background location, KMZ import, MultiPolygon GeoJSON import, and everything in the spec's
  "Later" roadmap row
- Per-cell delete for raster tiles (overlay data can be deleted per layer)

## Setup

Requires a native dev build, not Expo Go — MapLibre needs native modules.

```bash
npm install
npx expo prebuild   # generates ios/ and android/ (gitignored, regenerate anytime)
npx expo run:ios    # or: npx expo run:android
```

Android release build (JS bundled into the APK, so it runs without Metro; signed with the debug
key, fine for sideloading). Use JDK 17 or 21 — the Gradle/AGP toolchain doesn't support newer
JDKs like 25 — and `arm64-v8a` only to keep it fast:

```bash
npx expo prebuild --platform android
cd android
JAVA_HOME=/usr/lib/jvm/java-21-openjdk ANDROID_HOME=$HOME/Android/Sdk NODE_ENV=production \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
adb install -r app/build/outputs/apk/release/app-release.apk
```

Before trusting any of this on a real device, work through the Phase 0 spike checklist in
`docs/SPEC.md` §13 — especially the MBTiles-while-downloading and `mbtiles://`-path-format risks
in §12, which are the biggest unverified assumptions in the codebase.

See [AGENTS.md](AGENTS.md) for the project's coding conventions (React Navigation, not Expo
Router — this project intentionally deviates from the Expo template default; see the spec's
architecture section for why).

## Regenerating the bundled starter data

The land / MVUM / POI data under `assets/` is real data for the cell-aligned starter region
(southwest Idaho/Treasure Valley, `src/packs/region.ts`), fetched by the same TypeScript code the
app runs on-device (`src/packs/`). To refresh it, or debug a pack for any bbox:

```bash
node tools/build_starter_pack.mjs            # land, mvum, poi (all) or one: ... land
node tools/fetch_blm_sma.mjs                 # BLM private/unknown cross-check
node tools/fetch_idfg_units.mjs              # Idaho hunt units (statewide; re-run each season)
node tools/fetch_pack.mjs osm -116.3 43.6 -116.1 43.7 out.json   # any cell pack (land|mvum|trails|poi|osm), any bbox
node tools/build_glyphs.mjs                  # regenerate the bundled label glyphs
```

## Data & attribution

- Basemaps: **USGS The National Map** (public domain)
- Public land: **USGS PAD-US** — federal via a USDOT ArcGIS mirror, state/local via USGS's PAD-US
  4.1 service (public domain) — + **BLM SMA** (public domain) for the private/unknown cross-check
- Forest roads/trails: **USFS Motor Vehicle Use Map** via the Enterprise Data Warehouse (public
  domain)
- USFS trails: **USFS National Forest System trails** via the Enterprise Data Warehouse (public
  domain)
- Wildfire perimeters: **NIFC** WFIGS interagency perimeters (public domain)
- Weather radar: **NOAA / National Weather Service** MRMS base reflectivity (public domain)
- Water and slope: **USGS National Hydrography Dataset** and **USGS 3DEP** elevation (public
  domain); wetlands: **USFWS National Wetlands Inventory** (public domain)
- Land managers: **BLM National Surface Management Agency** (public domain)
- Idaho hunting units: **Idaho Department of Fish and Game** open GIS data — best representation
  only, no warranty
- POI pins, roads/trails/labels: **© OpenStreetMap contributors** (ODbL)
- Full licensing checklist: [docs/SPEC.md §11](docs/SPEC.md#11-licensing-and-attribution-checklist)

Map data may be out of date or incorrect. Public-land boundaries are for planning only — verify
land status and access on the ground. Not for navigation in emergencies.

## License

MIT — see [LICENSE](LICENSE).
