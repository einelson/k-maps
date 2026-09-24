# K-Maps

Free, offline-first outdoor maps for iOS and Android — topo, satellite, and hybrid basemaps,
unlimited pins/lines/areas, and a public-vs-private land layer. No subscription, no paywalled
offline mode, all-free data (USGS, PAD-US, OpenStreetMap).

Full design spec, data sources, architecture, and phased roadmap: **[docs/SPEC.md](docs/SPEC.md)**.

## Status

All screens and data flows from the spec are wired up and exercised by typecheck/lint, but
**nothing has run on a simulator or physical device yet** — this environment has had none
available. That's the one gate everything below is written against but unverified by.

**Working (as far as static analysis can confirm):**

- Expo (TypeScript) app with React Navigation, MapLibre v11, Zustand, expo-sqlite
- Live online basemap (USGS Topo/Satellite/Hybrid) with base-map switching, plus an "offline"
  toggle that renders from a downloaded MBTiles file via MapLibre Native's `mbtiles://` scheme
  instead of live tiles (§4.6) — the scheme itself is confirmed to exist upstream, but this app's
  exact path handling is unverified (§12.4)
- Public land layer: real PAD-US data (federal agencies) via a USDOT ArcGIS mirror, styled by
  `Pub_Access` per §6.3, tap-for-details card. Plus a BLM "private/unknown" cross-check overlay
  (§2) — both fetched for one starter bbox by `tools/fetch_land.mjs` / `tools/fetch_blm_sma.mjs`
  and bundled as static assets, not the full state-GDB pipeline in `tools/pad_us_to_mbtiles.sh`
- Pre-built POI pins for boat launches and campsites/trailheads (not in the original spec — added
  by request), pulled from real OSM data via Overpass (`tools/fetch_pois.mjs`), with independent
  show/hide toggles and a tap card with a "Get Directions" button that hands off to the phone's
  own maps app (`geo:` intent on Android, Apple Maps on iOS). Same Directions button on point
  features in the item editor
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
  downloader with resume (§4) — writes real files, but see the device-testing caveat above
- Laptop-side pipeline scripts: PAD-US/BLM/OSM-POI fetch-and-clip (`tools/fetch_*.mjs`, hit real
  APIs), plus the original full-pipeline scripts for PAD-US GDB → MBTiles and Protomaps → MBTiles
  (`tools/pad_us_to_mbtiles.sh`, `tools/osm_extract.sh`)

**Not implemented:**

- MVUM forest-roads overlay — toggle exists in the UI (disabled) but no data source is wired up
- Likely-private shading (§6.4) — the spec itself defers this to "later," so it stayed deferred
- Background location, and everything else in the spec's "Later" roadmap row

## Setup

Requires a native dev build, not Expo Go — MapLibre needs native modules.

```bash
npm install
npx expo prebuild   # generates ios/ and android/ (gitignored, regenerate anytime)
npx expo run:ios    # or: npx expo run:android
```

Before trusting any of this on a real device, work through the Phase 0 spike checklist in
`docs/SPEC.md` §13 — especially the MBTiles-while-downloading and `mbtiles://`-path-format risks
in §12, which are the biggest unverified assumptions in the codebase.

See [AGENTS.md](AGENTS.md) for the project's coding conventions (React Navigation, not Expo
Router — this project intentionally deviates from the Expo template default; see the spec's
architecture section for why).

## Regenerating the bundled starter data

The POI pins and land layers under `assets/` are real data for one starter bbox (southwest
Idaho/Treasure Valley, defined in `tools/region.mjs`), fetched directly from public APIs — not
placeholders. To refresh them or point at a different region:

```bash
node tools/fetch_pois.mjs [west south east north]
node tools/fetch_land.mjs [west south east north]
node tools/fetch_blm_sma.mjs [west south east north]
```

## Data & attribution

- Basemaps: **USGS The National Map** (public domain)
- Public land: **USGS PAD-US** via a USDOT ArcGIS mirror (public domain) + **BLM SMA** (public
  domain) for the private/unknown cross-check
- POI pins, roads/trails/labels: **© OpenStreetMap contributors** (ODbL)
- Full licensing checklist: [docs/SPEC.md §11](docs/SPEC.md#11-licensing-and-attribution-checklist)

Map data may be out of date or incorrect. Public-land boundaries are for planning only — verify
land status and access on the ground. Not for navigation in emergencies.

## License

MIT — see [LICENSE](LICENSE).
