import { XMLParser } from 'fast-xml-parser';
import type { Geometry, Position } from 'geojson';

import type { Feature } from './types';
import type { TrackSamples } from '../features/trackStats';
import type { ParsedImportFeature } from './importTypes';
import { gpxColorToPalette } from '../features/colorMatch';
import { parseTransport, transportMode, type TransportId } from '../features/transport';
import { asArray, escapeXml, textOf } from './xmlUtil';

/**
 * §7.4: GPX has no polygon primitive, so area features export as a closed
 * track (their outer ring) — geometry fidelity is lost on round-trip for
 * those, which is an accepted GPX limitation, not a bug here.
 */
export function featuresToGpx(features: Feature[], samplesByFeatureId: Map<number, TrackSamples> = new Map()): string {
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
      const samples = geometry.type === 'LineString' ? alignedSamples(samplesByFeatureId.get(f.id), ring.length) : null;
      const trkpts = ring.map(([lon, lat], i) => trkpt(lon, lat, samples, i)).join('\n');
      // GPX 1.1's <type> ("classification of the track") sits after <desc> and before <trkseg>.
      const gpxType = geometry.type === 'LineString' ? transportMode(f.transport)?.gpxType : null;
      const typeTag = gpxType ? `<type>${escapeXml(gpxType)}</type>` : '';
      trks.push(`  <trk>${nameTag}${descTag}${typeTag}<trkseg>\n${trkpts}\n    </trkseg></trk>`);
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

/** Samples only describe the line when there is exactly one per vertex (an edit can change the vertex count). */
function alignedSamples(samples: TrackSamples | undefined, pointCount: number): TrackSamples | null {
  if (!samples) return null;
  const times = samples.times?.length === pointCount ? samples.times : null;
  const elevations = samples.elevations?.length === pointCount ? samples.elevations : null;
  return times || elevations ? { times, elevations } : null;
}

function trkpt(lon: number, lat: number, samples: TrackSamples | null, index: number): string {
  const ele = samples?.elevations?.[index];
  const time = samples?.times?.[index];
  const children = [
    ele != null ? `<ele>${ele}</ele>` : '',
    time != null && Number.isFinite(time) ? `<time>${new Date(time).toISOString()}</time>` : '',
  ].join('');
  return children ? `      <trkpt lat="${lat}" lon="${lon}">${children}</trkpt>` : `      <trkpt lat="${lat}" lon="${lon}"/>`;
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
      name: textOf(wpt.name),
      notes: gpxNotes(wpt),
      geometry: { type: 'Point', coordinates: [lon, lat] },
      folderPath: [],
      color: extensionColor(wpt.extensions),
    });
  }

  for (const trk of asArray<any>(gpx.trk)) {
    for (const seg of asArray<any>(trk.trkseg)) {
      const { coordinates, samples } = gpxTrackPoints(asArray<any>(seg.trkpt));
      if (coordinates.length < 2) continue;
      results.push({
        name: textOf(trk.name),
        notes: gpxNotes(trk),
        geometry: { type: 'LineString', coordinates },
        folderPath: [],
        color: extensionColor(trk.extensions),
        ...transportField(trk),
        ...(samples ? { track: samples } : {}),
      });
    }
  }

  for (const rte of asArray<any>(gpx.rte)) {
    const coordinates = gpxPoints(asArray<any>(rte.rtept));
    if (coordinates.length < 2) continue;
    results.push({
      name: textOf(rte.name),
      notes: gpxNotes(rte),
      geometry: { type: 'LineString', coordinates },
      folderPath: [],
      color: extensionColor(rte.extensions),
      ...transportField(rte),
    });
  }

  return results;
}

/** `{ transport }` when a track or route's `<type>` names a way of getting around we know, else nothing. */
function transportField(node: any): { transport: TransportId } | Record<string, never> {
  const transport = parseTransport(textOf(node.type));
  return transport ? { transport } : {};
}

/** `<desc>` and `<cmt>` both hold free text (Garmin devices fill `cmt`); keep whichever exist, once each. */
function gpxNotes(node: any): string | null {
  const parts = [textOf(node.desc), textOf(node.cmt)].filter((part): part is string => !!part?.trim());
  return parts.length === 0 ? null : [...new Set(parts)].join('\n\n');
}

/**
 * Color from an `<extensions>` block: Garmin's `gpxx:DisplayColor`, OsmAnd's `color`, and similar. Exporters
 * pick different namespace prefixes and nesting, so this matches on the local element name at any shallow depth.
 */
function extensionColor(extensions: any, depth = 0): string | null {
  if (!extensions || typeof extensions !== 'object' || depth > 3) return null;
  for (const [key, value] of Object.entries(extensions)) {
    if (key.startsWith('@_')) continue;
    const localName = key.split(':').pop()!.toLowerCase();
    if (localName === 'displaycolor' || localName === 'color') {
      const text = textOf(value);
      const color = text ? gpxColorToPalette(text) : null;
      if (color) return color;
    } else {
      const nested = extensionColor(value, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * A track's usable points plus the time and elevation of each. Points with bad coordinates are dropped from
 * all three together so they stay lined up. Times are kept only if every kept point has one (a partly
 * stamped track can't give a meaningful duration); elevations may have gaps.
 */
function gpxTrackPoints(points: any[]): { coordinates: Position[]; samples: TrackSamples | null } {
  const coordinates: Position[] = [];
  const times: (number | null)[] = [];
  const elevations: (number | null)[] = [];
  for (const p of points) {
    const lon = Number(p['@_lon']);
    const lat = Number(p['@_lat']);
    if (Number.isNaN(lon) || Number.isNaN(lat)) continue;
    coordinates.push([lon, lat]);
    const timeText = textOf(p.time);
    const time = timeText ? Date.parse(timeText) : NaN;
    times.push(Number.isNaN(time) ? null : time);
    const eleText = textOf(p.ele);
    const ele = eleText?.trim() ? Number(eleText) : NaN;
    elevations.push(Number.isFinite(ele) ? ele : null);
  }
  const allTimed = times.length > 0 && times.every((t) => t != null);
  const anyElevation = elevations.some((e) => e != null);
  if (!allTimed && !anyElevation) return { coordinates, samples: null };
  return {
    coordinates,
    samples: {
      times: allTimed ? (times as number[]) : null,
      elevations: anyElevation ? elevations : null,
    },
  };
}

function gpxPoints(points: any[]): Position[] {
  return points
    .map((p): Position => [Number(p['@_lon']), Number(p['@_lat'])])
    .filter(([lon, lat]) => !Number.isNaN(lon) && !Number.isNaN(lat));
}
