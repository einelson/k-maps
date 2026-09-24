#!/usr/bin/env bash
# Extracts an OSM roads/trails/labels pack from a Protomaps daily PMTiles
# build and converts it to MBTiles for on-device rendering (spec §6.2).
#
# Requires: pmtiles CLI (https://github.com/protomaps/go-pmtiles).
# MapLibre Native reads MBTiles, not PMTiles, for offline packs (§3, "Key choices").
#
# Usage: tools/osm_extract.sh <YYYYMMDD> <minLon,minLat,maxLon,maxLat> <region_id> [maxzoom]
# Example: tools/osm_extract.sh 20260101 -117.3,41.9,-111.0,49.0 id 15

set -euo pipefail

BUILD_DATE="${1:?Usage: $0 <YYYYMMDD> <bbox> <region_id> [maxzoom]}"
BBOX="${2:?Missing bbox: minLon,minLat,maxLon,maxLat}"
REGION="${3:?Missing region_id, e.g. id}"
MAXZOOM="${4:-15}"

OUT_DIR="$(dirname "$0")/../packs"
PMTILES="$OUT_DIR/osm_${REGION}.pmtiles"
MBTILES="$OUT_DIR/osm_${REGION}.mbtiles"

mkdir -p "$OUT_DIR"

echo "== Extracting bbox $BBOX from the ${BUILD_DATE} Protomaps build =="
pmtiles extract "https://build.protomaps.com/${BUILD_DATE}.pmtiles" "$PMTILES" \
  --bbox="$BBOX" --maxzoom="$MAXZOOM"

echo "== Converting to MBTiles =="
# Confirm your pmtiles CLI version supports `convert`; otherwise rebuild with
# Planetiler from the extracted region instead (see spec §6.2).
pmtiles convert "$PMTILES" "$MBTILES"

echo "Done: $MBTILES"
echo "Attribution to OpenStreetMap (ODbL) must stay visible on the map surface — see §11."
