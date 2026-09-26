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
- **Land, MVUM, USFS trails, POI and OSM data work anywhere in the United States — and only there.** Downloads → *Pick an area*
  fetches each picked square straight from the public services on the device (PAD-US, USFS
  MVUM and trails, Overpass) and stores one JSON file per cell; the map draws them via MapLibre
  `file://` GeoJSON sources. The southwest Idaho starter region (30 cells) is still bundled so
  first launch isn't empty. Cell-aligned, so downloaded cells never overlap it, and outlines are
  stripped along cell edges so there are no artificial grid lines
- **Land coverage grows as you pan.** The bundled starter region used to be the only place public
  land showed. Now, while online, the main map fetches public land (+ likely-private shading),
  MVUM and USFS trails for the z10 cells in view (from zoom 9 in — the same zoom the map starts drawing
  downloaded cells at — nearest cells first, at most 12 per view, one at a time, only for overlays that
  are switched on) and keeps them on the device, so anywhere you've looked works offline later. After two
  failures in a row it assumes there's no signal and pauses for two minutes; a failed cell isn't retried
  for five. A chip at the top of the map says what's going on: "Loading map data…", "Zoom in to see land
  data here" (below zoom 9, outside the bundled region and with nothing downloaded at the middle of the view — otherwise
  the layer just looks like it only exists around Boise), or "Preparing the zoomed-out land view…" while overview blocks are made or "Couldn't load land data" (after those failures). Switch it off with Layers →
  *Load land data as I pan*. OSM and POI stay manual — the free Overpass servers are too slow to fetch
  behind your back. How big is "everywhere"? Measured: Idaho's 329 cells are 60 MB of land data on the
  phone (184 KB a cell on average, 1.3 MB at most) and a 15 MB download, and the app's own fetcher takes
  4–10 s a cell on a laptop (Salt Lake, Missoula and central Nevada cells). The whole US (15,288 z10 cells
  that touch US land, 6,065 of them Alaska) came to 1.4 GB of land data on a phone and a 388 MB download —
  fine a state at a time, too much to ship in the app, which is why panning, Pick an area and region packs
  exist instead of one big download
- **Downloads is three tabs, not one long scroll.** *Pick an area* (the map, what to save, a footer
  that always shows the total, and the Download button at the right end of the header), *Ready-made* (a state's land
  and trail data, and hunting units — the hunting-units list starts folded, with the states already on the phone first)
  and *On this phone* (what's stored **split by state**, free space, delete overlay data a state or a layer at a time).
  Under the map, *2 · Choose what to save* is a folded bar that summarises the choices; tapping it opens the options in
  a sheet over the map (the map itself never resizes), with the running total still visible beneath.
  A tap on the map picks a **block of squares sized to the zoom** — 1 square from about zoom 7 in, then 2×2, 4×4, 8×8,
  16×16 as you zoom out — always 70–140 dp (a comfortable fingertip) on screen; the grid it picks from is drawn on the
  map, tapping a picked block again puts it back, and *Pick everything in view* picks the whole screen (at most 500
  squares by hand; Idaho is 329) (`src/downloads/blockSelect.ts`). A **crosshair** marks the middle of the map and
  outlines the block under it; the button at the bottom (*Pick this square* / *Pick these 4 squares* / *Pick the rest* /
  *Remove this square*) acts on that block, so a square can be lined up precisely instead of tapped. Squares already on
  the phone are skipped, so a big selection can be re-run after a hiccup without fetching everything again. The
  footer shows size and time before you start and says why the Download button is off (for example, the
  phone has no room); anything over 1 GB asks first, and live progress (Cancel, and which files failed
  and why) keeps running if you leave the screen (`src/downloads/startDownload.ts`)
- **Whole state, with everything.** Ready-made packs only carry overlay data (land, forest roads, trails, OSM, POI) —
  never offline map pictures. *Pick an area → Pick a whole state…* selects every square of a state (all 50, from the
  bundled `assets/us/us-state-cells.json`; a state can go past the 500-square hand-picking cap) so the same layer choices
  apply, map pictures included. When a state is picked whole and its ready-made pack is published, its overlay layers
  install from the pack (a few zips) and only the map pictures are fetched square by square
  (`planDownload`'s `region` jobs); anything else falls back to per-square fetching. Ready-made state cards link to
  Pick an area with the state already picked ("Also save offline map pictures of …")
- **Remembers how you left the app.** Base map, which layers are on and their opacity, name labels,
  offline-maps and load-as-I-pan switches, POI toggles, the active map filters and saved filter presets,
  saved views, the download choices (map pictures, overlay data, detail level) and where the map was
  looking are saved as they change and restored on the next launch, alongside units, coordinate format and
  appearance (`src/state/persistHelpers.ts`). A layer added in a later version starts from its default
  instead of being undefined, and unreadable saved values fall back to defaults. Not remembered: the
  location dot (needs this session's permission) and the My Content search box
- **US only.** The app draws nothing for anywhere else. `assets/us/us-cells.json` (1.4 MB, built by
  `tools/build_us_outline.mjs` from the Census Bureau's 1:500,000 state boundaries, which follow the shoreline) says
  for each z10 cell whether it is wholly inside the US, wholly outside it, or on a coast or border — and for those
  the exact US part of the cell (`src/packs/usCoverage.ts`). Every fetcher gets it: a cell with no US land is never
  fetched, "likely private" is inferred only from US land (so no purple over the ocean, the Great Lakes, Canada or
  Mexico), and in a coast or border cell OSM roads and POI pins outside the US are cut away (`src/packs/usFilter.ts`).
  The as-you-pan loader skips such cells, and the Downloads picker can't pick them ("There is no US land there").
  Coordinates on the border are good to about 250 m, the resolution of the source boundaries
- **Whole states (Downloads → Ready-made).** All 50 states are prebuilt on the repo's rolling `data` GitHub release,
  each as up to five layers — public land + private shading, forest roads (MVUM), USFS trails, OpenStreetMap roads &
  trails and OSM points of interest — one download per layer instead of fetching hundreds of cells from the public
  services. A layer over ~50 MB is split into ~40 MB parts (the app unzips a file in memory), installed one after
  another and counted as one. A state is a folded card that opens once anything from it is on the phone. The zip
  holds the exact per-cell files the on-device downloader writes, so installing is unzipping into the same layout; it
  never overwrites bundled starter cells or cells the device fetched after the pack was built, and shows "Update"
  when a newer pack is published. A cell on a state line is in both states' packs (its content is the same either
  way). Built by `tools/build_region_pack.mjs`. Measured for the published packs — download (on the phone once
  unzipped): public land + private shading 388 MB (1.4 GB), forest roads 168 MB (0.6 GB), USFS trails 48 MB
  (0.15 GB), OSM points of interest 5 MB (10 MB), OSM roads & trails 2.0 GB (8.8 GB); 2.6 GB for the whole
  US in 270 files, none over 50 MB. By state: California is the largest at 218 MB, then Texas 122 MB, Alaska 96 MB;
  Rhode Island is 7 MB. OSM is most of every state, so it's the one to skip if space is tight
- **Only cells near the view are drawn.** Every downloaded cell is a MapLibre source plus several style
  layers, so a state's worth can't all be mounted at once. The map mounts the cells in view plus one
  cell around them (at most 30 per layer) from zoom 9 in (`src/map/cellWindow.ts`); the bundled
  starter data is one source and always draws
- **Downloaded land shows at any zoom.** Below zoom 9 those cells aren't mounted, so a downloaded state used to
  vanish when zoomed out (only the bundled Boise data drew). The public-land and likely-private fills now have a
  zoomed-out *overview* (`src/map/landOverview.ts`): the fills of every downloaded cell in an 8×8 block, boiled down to
  what the fills need and snapped to a lattice aligned to the cell edges (so borders shared by two polygons — or two
  cells — stay shared, no gaps), joined into one small file per block. Two levels: *coarse* for state-sized views (zoom
  5–7.5, ~5 KB a cell) and *fine* for county-sized ones (7.5–9, ~24 KB a cell), at most 24 / 12 blocks mounted. Built
  on the phone from cells it already has (`landOverviewBuild.ts`, `useLandOverview.ts`), cached in
  `<documents>/packs/land-overview/`, rebuilt when a block's cells change and tidied away when its cells are deleted.
  Fills only — no outlines, and not tappable; from zoom 9 the detailed cells draw. Below zoom 5 nothing is drawn. Roads,
  trails, OSM and POI stay zoom-9-and-in (their layers have their own minimum zooms; a state of them is gigabytes)
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
- **Hunting units for 30 states** (each state wildlife agency's own hunt units, management zones or hunt
  districts — GMUs, WMUs, deer permit areas ...), normalized to one shape so any state draws and
  describes the same way: dashed boundaries with unit numbers, tap for the unit, its regulation links and
  the agency's hunting-regulations page. Every state is **downloaded per state** from Downloads → Hunting
  units (12.5 MB for all 30, 0.02–2.7 MB each; nothing is built into the app), stored on the device and
  drawn from there, so they work with **no connection**. States that publish separate
  species layers (Wyoming, Montana, Michigan, ...) get a picker for which one to show. Outline-only on
  purpose — MapLibre gives a tap to the topmost source, so a fill would block taps on the land polygons
  beneath. **Only official agency data is included** (each source is checked to belong to the state's own
  wildlife agency or state GIS office; a state with no official layer is left out rather than filled from a
  third-party copy). **Hunters are told to check their local laws and regulations**: a required
  "I understand" the first time the layer is turned on or a state is downloaded, a notice on the Downloads
  section, the Layers note, and on every unit card — which also states when the source data was last edited
  (or that the agency's service doesn't publish a date), so nobody mistakes an old layer for a current one.
  **A layer whose source data was last edited 3+ years ago must be accepted separately**: a notice naming
  each old layer and its age before it downloads, again on the map if already installed data has since aged
  past the line, a red warning in the Downloads list, and a warning row on that
  layer's unit cards. Acceptance is remembered per state for exactly the layers and dates shown, so newly
  old or changed data asks again, and removing a state resets it (`src/map/huntUnitStaleness.ts`)
  Only states in view are mounted (`src/map/huntUnitWindow.ts`), so downloading every state doesn't slow the map. Built by
  `tools/build_hunt_units.mjs`; see the coverage table below
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
- GPS dot toggle and **background GPS track recording** (§7.5) that keeps going with the screen locked
  or the app closed. Record track (in the "+" menu) starts a location task (`expo-location` +
  `expo-task-manager`, `src/features/trackTask.ts`) — on Android under a foreground service that shows a
  "Recording a track" notification, on iOS under the `location` background mode — which appends every
  fix to SQLite (`recording_session` / `recording_fixes`) as it arrives, so the recording survives the
  app being killed. Because the service is started while the app is on screen it needs only the ordinary
  location permission, not "Allow all the time". When you reopen the app it rebuilds the live recording
  from the database (`RecordingSync`) and restarts the service if the system killed it, saying in the
  panel that the line jumps across the gap. Denied permission with no way to re-prompt offers "Open
  Settings"; Location Services being off is reported up front. Fixes worse than 50 m accuracy are dropped
  (a cold GPS start otherwise draws a spike)
- **Recording button + panel.** While recording, a "● 12:34 · 1.23 mi" button sits on the map under the
  locate button. Tapping it (or "Track stats" in the "+" menu) opens a panel with the live clock and
  distance, the same stats and charts a saved track shows, and **Delete** (asks first) and **End & save**.
  Ending saves the track from the database, clears the recording only once it's safely saved, and opens
  the track's dashboard so the name, folder, color and tags are one tap away. A track is stored as a line
  with `source='track'` plus each point's time and altitude in `track_data`
- **Track dashboard** (`FeatureDetailScreen`, shown for recorded tracks and for GPX tracks that carry
  timestamps/elevation): distance, time, moving time (stretches under 0.5 m/s don't count), average
  speed, climb, descent, high and low point; an elevation chart (switch its x axis between time and
  distance) and a distance-over-time chart, both scrubbable by dragging a finger across them; and
  "Export GPX" with `<time>`/`<ele>` on every point. Numbers follow the Units setting. Elevation is
  smoothed (5-point average) and climb ignores changes under 3 m, so GPS noise doesn't inflate it. Charts
  are drawn with `react-native-svg` (`LineChart.tsx`, pure math in `src/features/chartMath.ts`); stats
  are computed in `src/features/trackStats.ts`. Editing a track's vertices that changes their count drops
  its samples, since they'd no longer line up
- **My Content is a folder browser.** Folders nest to any depth: browse in and out with a breadcrumb,
  add a folder inside the one you're in (+ Folder), and rename, move or delete one from its ⋯ menu.
  Deleting a folder never deletes pins: its pins and subfolders move up a level. Searching or filtering
  switches to one flat list across every folder (each item shows its folder path). A filter, export
  or hidden-folder setting on a folder applies to everything nested inside it
- **Tags button** (My Content header) opens a tag manager: add a tag without selecting anything, rename
  it (every item keeps it; names are unique ignoring case), or delete it (removed from every item after
  a confirmation that says how many; items are never deleted). Deleted tags and folders are also
  dropped from the active filter, saved filter presets and saved views
- Tags (assign/remove/filter), multi-select in Items (move/recolor/tag/delete/export), saved views
  capturing base map + overlays + POI toggles + filter (§5.3)
- Real GPX/KML/GeoJSON export and import (hand-rolled XML, `fast-xml-parser` for reading), a
  dedicated "export pins (points only)" action, export by folder or current filter, and a full
  DB+photos zip backup via the OS share sheet (§7.4)
- Import reads more than it writes, aimed at exports from onX, Gaia, CalTopo, Google My Maps/Earth, Organic
  Maps and Garmin (built from those apps' documented conventions and synthetic samples, not yet checked
  against real exports): KMZ (unzipped with `jszip`), format sniffed from the content rather than the file
  name, `MultiGeometry`/`MultiPoint`/`MultiLineString`/`MultiPolygon`/`GeometryCollection` split into
  single-part items, HTML descriptions turned into plain notes, GPX `<cmt>` kept as notes, and colors
  (KML styles and StyleMaps, GPX Garmin/OsmAnd extension colors, GeoJSON `color`/`stroke`/`marker-color`/
  `fill`) snapped to the nearest palette color by hue. Icons and line widths are not imported. Closed GPX
  tracks (how onX exports area shapes) get a "lines or areas?" prompt. An import is one transaction, so a
  failure leaves nothing behind
- "Open with K-Maps": Android intent filters (`app.json`) let a GPX/KML/KMZ/GeoJSON file opened from the
  Files app or a browser download land in K-Maps, which asks before importing
  (`src/navigation/IncomingImportHandler.tsx`). Only Android's *open* (`ACTION_VIEW`) is handled, not the
  share-sheet *send* (`ACTION_SEND`), which React Native doesn't surface — that would need
  `expo-share-intent` or a native module
- Cell math (`childTiles`, `tmsY`, cell↔lon/lat), an MBTiles writer, and a concurrency-limited
  downloader with resume (§4) — writes real files, but see the device-testing caveat above. The
  Downloads map now draws the cell grid state (selected / downloaded / partial), and max zoom is
  capped at z16 because USGS returns 404 for every tile past it (§12.3, probed)
- Laptop-side pipeline scripts: PAD-US/BLM/OSM-POI fetch-and-clip (`tools/fetch_*.mjs`, hit real
  APIs), plus the original full-pipeline scripts for PAD-US GDB → MBTiles and Protomaps → MBTiles
  (`tools/pad_us_to_mbtiles.sh`, `tools/osm_extract.sh`)

**Not implemented / known gaps:**

- BLM "private/unknown" cross-check is bundled for the starter region only (not downloadable)
- The US limits use 1:500,000 boundaries, so the border and shoreline in "likely private" and in OSM / POI are good
  to about 250 m (Chesapeake Bay and some other bays count as US land, as in the Census file). Territories (Puerto
  Rico, Guam, ...) are not covered
- OSM roads & trails and POI pins are prebuilt for all 50 states, but a cell you pick yourself is fetched from the
  public Overpass servers, which take minutes per cell — use Ready-made for anything bigger than a few cells
- Radar, NHD, NWI, slope angle and land managers are online-only rasters: nothing to download, no
  offline copy, no tap-to-identify. The spec's true-vector NHD/NWI (`ogr2ogr` → `tippecanoe`) and a
  build-time slope raster (`gdaldem slope`) would fix that but need a hosted tile pack
- Hunting units cover 30 states (table below). The other 20 have no official unit layer I could find
  (regulated by county or statewide, or the agency doesn't publish it as open data). Each state's
  boundaries are as current as its agency's service on the day the pack was built — several publish
  yearly, so re-run `tools/build_hunt_units.mjs --refresh --publish` each season. Arizona is left out
  on purpose: only third-party copies exist, and the rule is official boundaries only
- Downloaded overlay cells (region packs included) aren't drawn below zoom 9, to keep the number of map
  sources bounded; the bundled starter region still is. A statewide overview at low zoom would need
  simplified or tiled data
- The packs are a snapshot: land and trails from the day they were built, OSM from that day's Geofabrik extracts.
  Refreshing means re-running the builds below and publishing to the public GitHub release by hand
- As-you-pan loading covers land, MVUM and USFS trails only, and only in the main map (not the
  Downloads screen's), from zoom 9
- Photos store an absolute file URI; if the app's documents path ever changes they'd show "Missing"
- Point clustering only applies to your saved points, not the POI pins
- Import limits: polygon holes and KML `gx:Track` are dropped, waypoint/route `<ele>`/`<time>` and icons
  aren't kept (track points' are), GPX/KML export doesn't write colors (GeoJSON export does), and
  importing the same file twice duplicates it
- Track elevation is the phone's raw GPS altitude. expo-location documents it as height above the WGS 84
  ellipsoid, which differs from sea level by roughly 10–35 m across the US, so climb and descent are
  right but the high/low point can read off by that much (some Android phones already report sea level;
  not verified on the Galaxy S21). A geoid correction would fix it once the phone's behaviour is known
- Background recording is written but not yet proven on the Galaxy S21: whether it survives the app being
  swiped away varies by phone maker (expo-location documents "background location will stop if the user
  terminates the app"; a foreground service normally prevents that, but Samsung's battery manager can still
  kill it — set K-Maps to "Unrestricted" battery use). Nothing already recorded is lost either way: it's in
  SQLite and reopening the app picks it up, but there would be a gap
- iOS recording is configured but has never run on an iPhone (nothing here can build for iOS; only the
  generated Info.plist was checked: `UIBackgroundModes` has `location`). How it's meant to behave: the
  `location` background mode keeps a backgrounded, screen-locked app receiving fixes (blue status-bar
  pill); "Always" permission is offered once recording has started and only matters if the system
  terminates the app, which it can then relaunch. **iOS never relaunches an app the user force-quit
  (swiped away in the app switcher), so there a swipe-away ends the recording** — reopening K-Maps
  restores what was recorded, restarts recording and notes the gap in the panel. `timeInterval` is
  Android-only, so iOS records every 5 m of movement (no fixes while standing still)
- Not done for iOS: "Open in K-Maps" for GPX/KML files (needs `CFBundleDocumentTypes`), and a cloud
  build (`eas build --platform ios` needs an Apple developer account)
- The foreground-service notification uses the launcher icon as its small icon, which some Android versions
  draw as a white square; a dedicated monochrome notification icon would fix it
- Everything in the spec's "Later" roadmap row
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
node tools/build_hunt_units.mjs --check      # dry run of every state's hunt units: counts, samples, link check
node tools/fetch_pack.mjs osm -116.3 43.6 -116.1 43.7 out.json   # any cell pack (land|mvum|trails|poi|osm), any bbox
node tools/build_glyphs.mjs                  # regenerate the bundled label glyphs
```

## Building and publishing region packs

Everything runs on a laptop and lands in `packs/build/` (git-ignored). Order matters the first time:

```bash
node tools/build_us_outline.mjs            # the US map the fetchers use (assets/us/us-cells.json) + each state's cells
tools/build_all_states.sh                  # land, MVUM and USFS trails for all 50 states: five processes, a couple of hours
python3 -m venv packs/build/osmvenv && packs/build/osmvenv/bin/pip install osmium
tools/build_osm_states.sh                  # OSM roads + POI: downloads each state's Geofabrik extract and cuts it into cells
node tools/finalize_osm_cells.mjs          # merge cells two states share, apply the US limits
node tools/build_region_pack.mjs all land mvum trails poi osm   # zip every layer (splitting big ones) and write the manifest
node tools/publish_region_packs.mjs        # upload what changed to the `data` release (needs gh); manifest last
```

Or one state at a time: `node tools/build_region_pack.mjs idaho [land] [mvum] [trails] [poi] [osm] [--limit 4] [--part 0/2]`.

- **Land, MVUM, trails** are fetched by the same code the app runs on-device (`src/packs/`), a z10 cell at a time, and
  cached per layer in `packs/build/cache/cells/<layer>/` — shared by every state, so a cell on a state line is fetched
  once, and a failed cell only aborts that layer's zip; re-running retries just what is missing. Delete the cache to
  refetch fresh data (and `cache/cells/land` if `assets/us/us-cells.json` changes)
- **OSM and POI** can't come from the public Overpass servers at this scale (3-4 minutes per cell, measured, for about
  15,000 cells). `tools/osm_cells.py` cuts them out of Geofabrik's state extracts instead (pyosmium), following the
  app's rules exactly — the same classes, tags, 5-decimal rounding and cell clipping as `src/packs/osm.ts` — and a
  cell it produced for Boise matches the Overpass one to within 0.1% (16,850 vs 16,839 features)
- The app finds packs through the manifest at
  `https://github.com/einelson/k-maps/releases/download/data/manifest.json` (`src/packs/regionPacks.ts`, manifest
  format 2: a layer may be split into `<state>-<layer>-<n>.zip` parts that each list their cells)

## Hunting-unit coverage by state

| Status | States |
|---|---|
| **Downloadable** (Downloads → Hunting units) | AK AR CA CO CT FL HI ID KS KY MA ME MI MN MT ND NE NH NJ NM NV NY OR PA SC UT VT WA WI WY |
| **Left out on purpose** | AZ — only third-party copies of the AZGFD boundaries exist (a 2020 upload and a county mirror); no official layer found |
| **Not available to us** | SD — the agency's layers exist but require sign-in |
| **No official unit layer found** | AL DE GA IL IN IA LA MD MS MO NC OH OK RI TN TX VA WV |

What's in each downloadable state (sets are selectable per state): AK Game Management Units · AR Deer
Management Units · CA Deer Hunt Zones (approximate legal boundary) · CO Game Management Units · CT
Deer & Turkey Zones · FL Deer Management Units · HI Public Hunting Units · KS Deer Management Units · KY
Deer Zones + Elk Units · MA Wildlife Management Zones · ME Wildlife Management Districts · MI Deer, Bear,
Elk and Turkey Management Units · MN Deer Permit Areas + Elk Zones · MT Deer/Elk, Antelope, Black Bear,
Moose, Sheep and Goat districts · ND Deer, Elk and Moose Units · NE Deer + Antelope Units · NH Wildlife
Management Units · NJ Deer Management Zones · NM Game Management Units · NV Hunt Units · NY Wildlife
Management Units · OR Wildlife Management Units · PA Wildlife Management Units + Elk Zones · SC Game Zones
· UT Big Game Hunt Boundaries · VT Wildlife Management Units · WA Game Management Units · WI Deer
Management Units · WY Elk, Deer, Antelope, Moose and Black Bear Hunt Areas.

The "no official unit layer" states mostly regulate by county or statewide rather than by unit (Ohio's
own service confirms it: its deer, turkey and quail rules are per county), and I didn't find a unit or
zone layer published by the agency for the others. Turkey, waterfowl, upland and furbearer zones are not
included except where a state's main unit layer is shared with them (Michigan turkey units, Connecticut).
A state can be added by writing one entry in `src/huntUnits/registry.ts` (the layer URL plus how its
columns map to a unit and title); each entry's real example row is checked by a test.

## Building and publishing hunting units

```bash
node tools/build_hunt_units.mjs --check              # fetch every state, print counts/samples, check links; writes nothing
node tools/build_hunt_units.mjs OR WA                # build just these states into packs/build/
node tools/build_hunt_units.mjs --publish            # build all and upload zips + manifest to the `data` release
node tools/build_hunt_units.mjs --refresh MT --publish   # ignore the fetch cache for Montana (new season)
```

Fetched states are cached in `packs/build/cache/hunt/`; a failed state keeps its previous pack and
`--publish` refuses to upload from a run with failures. The manifest is shared with the region packs
(`tools/packManifest.mjs`): building one kind never drops the other's entries, even on a fresh checkout
(it starts from the published manifest).

## Data & attribution

- Basemaps: **USGS The National Map** (public domain)
- State and country outlines (which cells are US land): **U.S. Census Bureau** cartographic boundaries, 1:500,000
  (public domain)
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
- Hunting units: each state's **wildlife agency** open GIS data (named on every unit's card and in the
  manifest) — best representation only, no warranty; display only, simplified to about 30 m (Oregon is not simplified: ODFW's terms forbid altering its boundaries)
- POI pins, roads/trails/labels: **© OpenStreetMap contributors** (ODbL); the prebuilt state packs are cut from
  **Geofabrik** extracts of OpenStreetMap
- Full licensing checklist: [docs/SPEC.md §11](docs/SPEC.md#11-licensing-and-attribution-checklist)

Map data may be out of date or incorrect. Public-land boundaries are for planning only — verify
land status and access on the ground. Not for navigation in emergencies.

## License

MIT — see [LICENSE](LICENSE).
