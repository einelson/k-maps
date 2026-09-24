#!/usr/bin/env bash
# Builds a public-land vector tile pack from a PAD-US 4.1 state download (spec §6.2).
#
# Requires: gdal (ogrinfo, ogr2ogr), tippecanoe.
# Download the state GeoPackage/GDB first from the PAD-US 4.1 data page:
# https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-download
#
# Usage: tools/pad_us_to_mbtiles.sh <input.gpkg> <layer_name> <state_abbr>
# Example: tools/pad_us_to_mbtiles.sh PADUS4_1_State_ID.gpkg PADUS4_1Combined_StateID id

set -euo pipefail

INPUT="${1:?Usage: $0 <input.gpkg> <layer_name> <state_abbr>}"
LAYER="${2:?Missing layer_name — run: ogrinfo $INPUT}"
STATE="${3:?Missing state abbreviation, e.g. id}"

OUT_DIR="$(dirname "$0")/../packs"
GEOJSONL="$OUT_DIR/pad_${STATE}.geojsonl"
MBTILES="$OUT_DIR/land_${STATE}.mbtiles"

mkdir -p "$OUT_DIR"

echo "== Layers in $INPUT (confirm field names before running further) =="
ogrinfo "$INPUT"

echo "== Exporting $LAYER to line-delimited GeoJSON (WGS84) =="
ogr2ogr -f GeoJSONSeq -t_srs EPSG:4326 "$GEOJSONL" "$INPUT" "$LAYER" \
  -select "Pub_Access,Own_Type,Own_Name,Mang_Type,Mang_Name,Unit_Nm,Des_Tp,GAP_Sts"

echo "== Building vector tiles =="
tippecanoe -o "$MBTILES" -l public_land -Z4 -z14 \
  --drop-densest-as-needed --coalesce-densest-as-needed \
  --force "$GEOJSONL"

echo "Done: $MBTILES"
echo "Field names come from the PAD-US data manual — confirm with ogrinfo before trusting them."
