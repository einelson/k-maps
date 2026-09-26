#!/usr/bin/env bash
# Builds region packs (land, MVUM, USFS trails) for all 50 states with five processes at once: Alaska (6,000+ cells)
# split in two halves, the other 49 states split into three groups of about 3,500 cells each. Everything lands in the
# shared cell cache (packs/build/cache/cells), so re-running only retries what failed. Logs: packs/build/logs/.
#
#   tools/build_all_states.sh   # fetch + zip everything, update packs/build/manifest.json
#   then: node tools/publish_region_packs.mjs   # upload the zips and manifest to the `data` release
#
# Each process fetches at most 3 cells at a time, so about 15 requests are in flight against the public services.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p packs/build/logs
BUILD="node --no-warnings tools/build_region_pack.mjs"

GROUP_A="texas nevada wyoming washington michigan nebraska oklahoma iowa north-carolina pennsylvania louisiana tennessee south-carolina massachusetts new-hampshire connecticut"
GROUP_B="montana minnesota colorado arizona south-dakota kansas wisconsin new-york georgia arkansas maine ohio indiana maryland vermont delaware rhode-island"
GROUP_C="california oregon new-mexico idaho north-dakota utah missouri illinois florida virginia alabama mississippi kentucky west-virginia hawaii new-jersey"

$BUILD alaska --part 0/2 > packs/build/logs/alaska-0.log 2>&1 &
$BUILD alaska --part 1/2 > packs/build/logs/alaska-1.log 2>&1 &
$BUILD $GROUP_A > packs/build/logs/group-a.log 2>&1 &
$BUILD $GROUP_B > packs/build/logs/group-b.log 2>&1 &
$BUILD $GROUP_C > packs/build/logs/group-c.log 2>&1 &
wait

# Alaska's halves are in the cache: zip it.
$BUILD alaska > packs/build/logs/alaska-zip.log 2>&1 || echo "Alaska did not finish — see packs/build/logs/alaska-*.log"
if grep -l "failed" packs/build/logs/*.log > /dev/null 2>&1; then
  echo "Some cells failed — rerun this script to retry them (the rest are cached)."
fi
echo "Done: $(ls packs/build/*-land.zip 2>/dev/null | wc -l) land packs built."
