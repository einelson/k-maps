# packs/

Region packs: prebuilt, hosted copies of the per-cell overlay data (public land, MVUM forest roads, USFS
trails) for a whole region, so the app can install a state in one download per layer instead of fetching
it cell by cell from the public services (see README "Region packs").

- `build/` — **not checked in** (git-ignored). `node tools/build_region_pack.mjs <region>` writes
  `<region>-<layer>.zip` (one `<cx>_<cy>.json` per z10 cell, the same files the app stores on-device) and
  `manifest.json` here, with a resumable per-cell cache under `build/cache/`.
- The zips and manifest are published to the rolling **`data`** release of the GitHub repo
  (`node tools/build_region_pack.mjs <region> --publish`, needs `gh`); the app reads
  `https://github.com/einelson/k-maps/releases/download/data/manifest.json` (`src/packs/regionPacks.ts`).
- Regions are defined in `tools/regionCells.mjs`.
- Hunting units are built by `tools/build_hunt_units.mjs` into the same folder as `hunt-<st>.zip` (one `units.json` each) and
  listed under `huntUnits` in the same manifest; the states are defined in `src/huntUnits/registry.ts`.

The old `land_*.mbtiles` / `osm_*.mbtiles` design in SPEC §9 is not what shipped: the overlay layers render
from per-cell GeoJSON files, so packs are zips of those. `tools/pad_us_to_mbtiles.sh` and
`tools/osm_extract.sh` remain as the original full-pipeline scripts.
