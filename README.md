# K-Maps

Free, offline-first outdoor maps for iOS and Android — topo, satellite, and hybrid basemaps,
unlimited pins/lines/areas, and a public-vs-private land layer. No subscription, no paywalled
offline mode, all-free data (USGS, PAD-US, OpenStreetMap).

Full design spec, data sources, architecture, and phased roadmap: **[docs/SPEC.md](docs/SPEC.md)**.

## Status

Scaffolded per the spec's Phase 0/1 targets. Implemented so far:

- Expo (TypeScript) app with React Navigation, MapLibre, Zustand, expo-sqlite
- Live online map (USGS Topo/Satellite/Hybrid raster, §5.2) with base-map switching
- SQLite schema + repositories for folders/features/tags/coverage (§7.1)
- Filter state → MapLibre filter expression builder (§7.2)
- Draw-tool and measurement scaffolding (Turf-based length/area, §7.3)
- Cell math (`childTiles`, `tmsY`, cell↔lon/lat) and an MBTiles writer + concurrency-limited
  downloader (§4) — **written but not yet exercised on a device**
- All seven screens from §8, wired together in navigation
- Laptop-side pipeline scripts for PAD-US → MBTiles and OSM (Protomaps) extraction (§6.2)

Not yet done, in rough roadmap order:

- **On-device testing** — this environment has no iOS/Android simulator or device, so nothing
  above has been run yet. Before trusting it, work through the Phase 0 spike checklist in
  `docs/SPEC.md` §13, especially the MBTiles-while-downloading and `mbtiles://`-path-format risks
  in §12.
- Rendering downloaded MBTiles packs on the map (currently only the live online basemap renders;
  the downloader writes files but nothing reads them back yet)
- The land layer (public/private land styling) and its hosted-pack pipeline wiring
- GPX/KML/GeoJSON import/export and full backup (stubbed screen, no parsing yet)
- Saved views/filter presets UI, tags, multi-select in Items
- GPS tracks, MVUM overlay, BLM SMA cross-check, likely-private shading (Phase 5)

## Setup

Requires a native dev build, not Expo Go — MapLibre needs native modules.

```bash
npm install
npx expo prebuild   # generates ios/ and android/ (gitignored, regenerate anytime)
npx expo run:ios    # or: npx expo run:android
```

See [AGENTS.md](AGENTS.md) for the project's coding conventions (React Navigation, not Expo
Router — this project intentionally deviates from the Expo template default; see the spec's
architecture section for why).

## Data & attribution

- Basemaps: **USGS The National Map** (public domain)
- Public land: **USGS PAD-US 4.1** (public domain, USGS GAP)
- Roads/trails/labels: **© OpenStreetMap contributors** (ODbL), via Protomaps
- Full licensing checklist: [docs/SPEC.md §11](docs/SPEC.md#11-licensing-and-attribution-checklist)

Map data may be out of date or incorrect. Public-land boundaries are for planning only — verify
land status and access on the ground. Not for navigation in emergencies.

## License

MIT — see [LICENSE](LICENSE).
