import { XMLParser } from 'fast-xml-parser';
import type { Geometry, Position } from 'geojson';

import type { Feature } from './types';
import type { ParsedImportFeature } from './importTypes';
import { asArray, escapeXml } from './xmlUtil';

/**
 * §7.4: GPX has no polygon primitive, so area features export as a closed
 * track (their outer ring) — geometry fidelity is lost on round-trip for
 * those, which is an accepted GPX limitation, not a bug here.
 */
export function featuresToGpx(features: Feature[]): string {
  const wpts: string[] = [];
  const trks: string[] = [];

  for (const f of features) {
    const geometry = JSON.parse(f.geometry) as Geometry;
    const nameTag = f.name ? `<name>${escapeXml(f.name)}</name>` : '';
    const descTag = f.notes ? `<desc>${escapeXml(f.notes)}</desc>` : '';

    if (geometry.type === 'Point') {
      const [lon, lat] = geometry.coordinates;
      wpts.push(`  <wpt lat="${lat}" lon="${lon}">${nameTag}${descTag}</wpt>`);
    } else if (geometry.type === 'LineString' || geometry.type === 'Polygon') {
      const ring: Position[] = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates;
      const trkpts = ring.map(([lon, lat]) => `      <trkpt lat="${lat}" lon="${lon}"/>`).join('\n');
      trks.push(`  <trk>${nameTag}${descTag}<trkseg>\n${trkpts}\n    </trkseg></trk>`);
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="K-Maps" xmlns="http://www.topografix.com/GPX/1/1">',
    ...wpts,
    ...trks,
    '</gpx>',
  ].join('\n');
}

/**
 * Parser output is untyped XML JSON (attributes under `@_*` keys), so this
 * file leans on explicit `any` rather than modeling GPX's full schema.
 */
export function parseGpx(xml: string): ParsedImportFeature[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    // Keep text as text: with the default, <name>007</name> becomes the number 7 and the
    // `typeof === 'string'` guards below would silently drop it.
    parseTagValue: false,
    htmlEntities: true,
  });
  const doc = parser.parse(xml);
  const gpx = doc.gpx;
  if (!gpx) return [];

  const results: ParsedImportFeature[] = [];

  for (const wpt of asArray<any>(gpx.wpt)) {
    const lon = Number(wpt['@_lon']);
    const lat = Number(wpt['@_lat']);
    if (Number.isNaN(lon) || Number.isNaN(lat)) continue;
    results.push({
      name: typeof wpt.name === 'string' ? wpt.name : null,
      notes: typeof wpt.desc === 'string' ? wpt.desc : null,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      folderPath: [],
    });
  }

  for (const trk of asArray<any>(gpx.trk)) {
    for (const seg of asArray<any>(trk.trkseg)) {
      const coordinates = gpxPoints(asArray<any>(seg.trkpt));
      if (coordinates.length < 2) continue;
      results.push({
        name: typeof trk.name === 'string' ? trk.name : null,
        notes: typeof trk.desc === 'string' ? trk.desc : null,
        geometry: { type: 'LineString', coordinates },
        folderPath: [],
      });
    }
  }

  for (const rte of asArray<any>(gpx.rte)) {
    const coordinates = gpxPoints(asArray<any>(rte.rtept));
    if (coordinates.length < 2) continue;
    results.push({
      name: typeof rte.name === 'string' ? rte.name : null,
      notes: typeof rte.desc === 'string' ? rte.desc : null,
      geometry: { type: 'LineString', coordinates },
      folderPath: [],
    });
  }

  return results;
}

function gpxPoints(points: any[]): Position[] {
  return points
    .map((p): Position => [Number(p['@_lon']), Number(p['@_lat'])])
    .filter(([lon, lat]) => !Number.isNaN(lon) && !Number.isNaN(lat));
}
