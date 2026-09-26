#!/usr/bin/env bash
# Downloads each state's OpenStreetMap extract from Geofabrik (ODbL) and cuts it into raw per-cell roads / trails / POI
# with tools/osm_cells.py — the bulk alternative to the public Overpass servers, which take minutes per cell.
#
#   tools/build_osm_states.sh [state ...]   # default: all 50; two states at a time
#
# Needs a Python with pyosmium:  python3 -m venv packs/build/osmvenv && packs/build/osmvenv/bin/pip install osmium
# Raw cells go to packs/build/cache/osm-raw/<state>/{osm,poi}/; a state is skipped if that folder has a DONE marker.
# The extract itself is deleted once cut. Then run tools/finalize_osm_cells.mjs to merge, apply the US-only limits and zip.
set -uo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON:-packs/build/osmvenv/bin/python}"
RAW=packs/build/cache/osm-raw
SRC=packs/build/osm-src
mkdir -p "$RAW" "$SRC" packs/build/logs

STATES=("$@")
if [ ${#STATES[@]} -eq 0 ]; then
  STATES=(alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois \
    indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana \
    nebraska nevada new-hampshire new-jersey new-mexico new-york north-carolina north-dakota ohio oklahoma oregon \
    pennsylvania rhode-island south-carolina south-dakota tennessee texas utah vermont virginia washington west-virginia \
    wisconsin wyoming)
fi

one() {
  state="$1"
  if [ -f "$RAW/$state/DONE" ]; then echo "$state: already done"; return; fi
  pbf="$SRC/$state.osm.pbf"
  if [ ! -f "$pbf" ]; then
    curl -sfL --retry 3 -o "$pbf.part" "https://download.geofabrik.de/north-america/us/$state-latest.osm.pbf" \
      && mv "$pbf.part" "$pbf" || { echo "$state: download failed"; rm -f "$pbf.part"; return; }
  fi
  rm -rf "$RAW/$state"
  if nice -n 10 "$PY" tools/osm_cells.py "$pbf" "$RAW/$state" > "packs/build/logs/osm-$state.log" 2>&1; then
    touch "$RAW/$state/DONE"; rm -f "$pbf"; echo "$state: $(tail -1 "packs/build/logs/osm-$state.log")"
  else
    echo "$state: extraction failed — see packs/build/logs/osm-$state.log"
  fi
}
export -f one
export PY RAW SRC
printf '%s\n' "${STATES[@]}" | xargs -P 2 -I{} bash -c 'one {}'
echo "OSM extraction finished."
