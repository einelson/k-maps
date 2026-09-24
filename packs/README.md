# packs/

Generated vector tile packs (land, OSM) and the manifest the app reads to list/version them (§9).

- `manifest.json` — checked in. Currently has one placeholder entry; update `url`/`bytes`/`bbox` after you actually build and host a pack.
- `*.mbtiles` / `*.pmtiles` / `*.geojsonl` — **not** checked in (see `.gitignore`). These are built by the scripts in `/tools` and are too large for git. Host them on GitHub Releases or Cloudflare R2 (§12.9) and point `manifest.json` at the real URL.

To build a pack, see `tools/pad_us_to_mbtiles.sh` (public land) and `tools/osm_extract.sh` (roads/trails/labels).
