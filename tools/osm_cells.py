#!/usr/bin/env python3
"""
Cuts OpenStreetMap roads/trails and POI pins out of a Geofabrik state extract into raw per-cell GeoJSON, in the same
shape the app's Overpass fetchers produce (src/packs/osm.ts, src/packs/poi.ts) — but from a downloaded .osm.pbf, so a
whole state takes minutes instead of the hours (or days) the public Overpass servers would.

    tools/osm_cells.py <state.osm.pbf> <out-dir>

Writes <out-dir>/osm/<cx>_<cy>.json and <out-dir>/poi/<cx>_<cy>.json for every z10 cell that has something in it
(the cells are the same XYZ zoom-10 tiles as src/downloads/cells.ts). Each feature carries `_id` (the OSM way / node
id) so tools/finalize_osm_cells.mjs can merge cells that two states' extracts both touch, then applies the US-only
limits and drops `_id`.

Needs pyosmium (`pip install osmium`). Mirrors the app's rules exactly:
  - roads: highway=* in the same list as OSM_HIGHWAY_VALUES, minus footway=sidewalk|crossing; class by
    CLASS_BY_HIGHWAY; kept tags name/ref/surface/tracktype; coordinates rounded to 5 decimals *before* clipping,
    lines clipped to the cell, clipped ends snapped exactly onto the cell edge;
  - POI: nodes only — leisure=slipway (boatLaunches); tourism=camp_site, highway=trailhead or
    tourism=information + information=trailhead (campsitesTrails).
"""
import json
import math
import os
import sys

import osmium

CELLS = 1024  # z10

CLASS_BY_HIGHWAY = {
    'motorway': 'highway', 'motorway_link': 'highway', 'trunk': 'highway', 'trunk_link': 'highway',
    'primary': 'primary', 'primary_link': 'primary', 'secondary': 'primary', 'secondary_link': 'primary',
    'tertiary': 'street', 'tertiary_link': 'street', 'unclassified': 'street', 'residential': 'street',
    'living_street': 'street', 'road': 'street',
    'track': 'track',
    'path': 'path', 'footway': 'path', 'bridleway': 'path', 'cycleway': 'path', 'steps': 'path', 'pedestrian': 'path',
}
OPTIONAL_TAGS = ('name', 'ref', 'surface', 'tracktype')
COORD_DECIMALS = 5
CLIPPED_DECIMALS = 6


def lon_to_cx(lon):
    return math.floor((lon + 180) / 360 * CELLS)


def lat_to_cy(lat):
    rad = math.radians(lat)
    # Same expression as src/downloads/cells.ts (log(tan + 1/cos) == asinh(tan)), so cell edges agree exactly.
    return math.floor((1 - math.log(math.tan(rad) + 1 / math.cos(rad)) / math.pi) / 2 * CELLS)


def cell_bounds(cx, cy):
    west = cx / CELLS * 360 - 180
    east = (cx + 1) / CELLS * 360 - 180
    north = math.atan(math.sinh(math.pi * (1 - 2 * cy / CELLS))) * 180 / math.pi
    south = math.atan(math.sinh(math.pi * (1 - 2 * (cy + 1) / CELLS))) * 180 / math.pi
    return west, south, east, north


def clip_segment(x0, y0, x1, y1, w, s, e, n):
    """Liang-Barsky. Returns (ax, ay, bx, by, a_on_edge, b_on_edge) for the part inside [w,e]x[s,n], or None."""
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0 - w), (dx, e - x0), (-dy, y0 - s), (dy, n - y0)):
        if p == 0:
            if q < 0:
                return None
        else:
            r = q / p
            if p < 0:
                if r > t1:
                    return None
                if r > t0:
                    t0 = r
            else:
                if r < t0:
                    return None
                if r < t1:
                    t1 = r
    if t1 < t0:
        return None
    ax, ay = x0 + t0 * dx, y0 + t0 * dy
    bx, by = x0 + t1 * dx, y0 + t1 * dy
    return ax, ay, bx, by, t0 > 0, t1 < 1


def snap(value, low, high, decimals):
    """A clipped coordinate: exactly on the cell edge if it is on it, else rounded."""
    if abs(value - low) <= 1e-9:
        return low
    if abs(value - high) <= 1e-9:
        return high
    return round(value, decimals)


def clip_line(points, bounds):
    """Runs of `points` (list of (lon, lat)) inside `bounds`, each with >= 2 distinct points."""
    w, s, e, n = bounds
    runs = []
    run = []
    for i in range(len(points) - 1):
        x0, y0 = points[i]
        x1, y1 = points[i + 1]
        part = clip_segment(x0, y0, x1, y1, w, s, e, n)
        if part is None:
            if len(run) >= 2:
                runs.append(run)
            run = []
            continue
        ax, ay, bx, by, a_cut, b_cut = part
        a = (snap(ax, w, e, CLIPPED_DECIMALS), snap(ay, s, n, CLIPPED_DECIMALS)) if a_cut else (x0, y0)
        b = (snap(bx, w, e, CLIPPED_DECIMALS), snap(by, s, n, CLIPPED_DECIMALS)) if b_cut else (x1, y1)
        if a == b:
            continue
        if run and run[-1] == a:
            run.append(b)
        else:
            if len(run) >= 2:
                runs.append(run)
            run = [a, b]
    if len(run) >= 2:
        runs.append(run)
    return runs


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    pbf, out_dir = sys.argv[1], sys.argv[2]
    roads = {}  # (cx, cy) -> [(way id, feature json)]
    pins = {}
    counts = {'ways': 0, 'kept_ways': 0, 'nodes': 0, 'pins': 0}

    def add_pin(category, node, tags):
        loc = node.location
        feature = {
            'type': 'Feature',
            'properties': {'category': category, 'name': tags.get('name'), 'osm_id': node.id, '_id': node.id},
            'geometry': {'type': 'Point', 'coordinates': [loc.lon, loc.lat]},
        }
        pins.setdefault((lon_to_cx(loc.lon), lat_to_cy(loc.lat)), []).append((node.id, category, json.dumps(feature, separators=(',', ':'))))
        counts['pins'] += 1

    fp = osmium.FileProcessor(pbf).with_locations().with_filter(osmium.filter.KeyFilter('highway', 'leisure', 'tourism'))
    for obj in fp:
        if obj.is_node():
            tags = obj.tags
            if not obj.location.valid():
                continue
            counts['nodes'] += 1
            if tags.get('leisure') == 'slipway':
                add_pin('boatLaunches', obj, tags)
            if (
                tags.get('tourism') == 'camp_site'
                or tags.get('highway') == 'trailhead'
                or (tags.get('tourism') == 'information' and tags.get('information') == 'trailhead')
            ):
                add_pin('campsitesTrails', obj, tags)
        elif obj.is_way():
            tags = obj.tags
            highway = tags.get('highway')
            cls = CLASS_BY_HIGHWAY.get(highway)
            if not cls:
                continue
            counts['ways'] += 1
            if tags.get('footway') in ('sidewalk', 'crossing'):
                continue
            pts = []
            try:
                for nd in obj.nodes:
                    if nd.location.valid():
                        p = (round(nd.lon, COORD_DECIMALS), round(nd.lat, COORD_DECIMALS))
                        if not pts or pts[-1] != p:
                            pts.append(p)
            except osmium.InvalidLocationError:
                continue
            if len(pts) < 2:
                continue
            props = {'highway': highway, 'cls': cls}
            for key in OPTIONAL_TAGS:
                value = tags.get(key)
                if value:
                    props[key] = value
            props['_id'] = obj.id
            counts['kept_ways'] += 1
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            cx0, cx1 = lon_to_cx(min(xs)), lon_to_cx(max(xs))
            cy0, cy1 = lat_to_cy(max(ys)), lat_to_cy(min(ys))  # north is the smaller cy
            for cy in range(cy0, cy1 + 1):
                for cx in range(cx0, cx1 + 1):
                    runs = clip_line(pts, cell_bounds(cx, cy))
                    if not runs:
                        continue
                    geometry = (
                        {'type': 'LineString', 'coordinates': [list(p) for p in runs[0]]}
                        if len(runs) == 1
                        else {'type': 'MultiLineString', 'coordinates': [[list(p) for p in run] for run in runs]}
                    )
                    feature = {'type': 'Feature', 'properties': props, 'geometry': geometry}
                    roads.setdefault((cx, cy), []).append((obj.id, json.dumps(feature, separators=(',', ':'))))

    for kind, cells in (('osm', roads), ('poi', pins)):
        directory = os.path.join(out_dir, kind)
        os.makedirs(directory, exist_ok=True)
        for (cx, cy), items in cells.items():
            items.sort(key=lambda item: item[0])
            with open(os.path.join(directory, f'{cx}_{cy}.json'), 'w') as handle:
                handle.write('{"type":"FeatureCollection","features":[')
                handle.write(','.join(item[-1] for item in items))
                handle.write(']}')
    print(f"{os.path.basename(pbf)}: {counts['kept_ways']} road ways (of {counts['ways']} highway ways), "
          f"{counts['pins']} pins; {len(roads)} road cells, {len(pins)} pin cells")


if __name__ == '__main__':
    main()
