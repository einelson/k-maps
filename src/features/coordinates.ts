import type { CoordinateFormat } from '../state/useSettingsStore';

/** Coordinate display formats from spec §7.3: decimal degrees, DMS, and UTM. */

function toDms(value: number, positive: string, negative: string): string {
  const hemisphere = value >= 0 ? positive : negative;
  const abs = Math.abs(value);
  let degrees = Math.floor(abs);
  let minutes = Math.floor((abs - degrees) * 60);
  let seconds = Number((((abs - degrees) * 60 - minutes) * 60).toFixed(1));
  // Rounding seconds to 0.1 can carry: 59.96" -> 60.0".
  if (seconds >= 60) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes = 0;
    degrees += 1;
  }
  return `${degrees}°${String(minutes).padStart(2, '0')}'${seconds.toFixed(1).padStart(4, '0')}"${hemisphere}`;
}

const UTM_BAND_LETTERS = 'CDEFGHJKLMNPQRSTUVWX';

function utmZoneNumber(lon: number, lat: number): number {
  // Norway and Svalbard don't follow the regular 6° grid.
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) return 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) return 31;
    if (lon >= 9 && lon < 21) return 33;
    if (lon >= 21 && lon < 33) return 35;
    if (lon >= 33 && lon < 42) return 37;
  }
  // Wrap first so lon = 180 (or 190) lands in zone 1 (or 1), not a nonexistent zone 61/62.
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return Math.floor((wrapped + 180) / 6) + 1;
}

/**
 * WGS84 lon/lat -> UTM via the Krüger series (Karney 2011), truncated at 3rd
 * order — sub-millimetre error inside a zone. Returns null outside UTM's
 * 80°S–84°N coverage (polar regions use UPS, which this doesn't do).
 */
export function toUtm(
  lon: number,
  lat: number
): { zone: number; band: string; easting: number; northing: number } | null {
  if (lat < -80 || lat > 84) return null;

  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const n = f / (2 - f);
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
  const alpha = [
    n / 2 - (2 * n ** 2) / 3 + (5 * n ** 3) / 16,
    (13 * n ** 2) / 48 - (3 * n ** 3) / 5,
    (61 * n ** 3) / 240,
  ];

  const zone = utmZoneNumber(lon, lat);
  const centralMeridian = (zone - 1) * 6 - 180 + 3;
  const phi = (lat * Math.PI) / 180;
  const lambda = ((lon - centralMeridian) * Math.PI) / 180;

  const c = (2 * Math.sqrt(n)) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)));
  const xiPrime = Math.atan2(t, Math.cos(lambda));
  const etaPrime = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));

  let xi = xiPrime;
  let eta = etaPrime;
  alpha.forEach((aj, i) => {
    const j = i + 1;
    xi += aj * Math.sin(2 * j * xiPrime) * Math.cosh(2 * j * etaPrime);
    eta += aj * Math.cos(2 * j * xiPrime) * Math.sinh(2 * j * etaPrime);
  });

  const easting = 500000 + k0 * A * eta;
  const northing = (lat < 0 ? 10000000 : 0) + k0 * A * xi;
  const band = UTM_BAND_LETTERS[Math.min(Math.floor((lat + 80) / 8), UTM_BAND_LETTERS.length - 1)];
  return { zone, band, easting, northing };
}

export function formatCoordinate(lon: number, lat: number, format: CoordinateFormat): string {
  switch (format) {
    case 'dms':
      return `${toDms(lat, 'N', 'S')} ${toDms(lon, 'E', 'W')}`;
    case 'utm': {
      const utm = toUtm(lon, lat);
      if (!utm) return `${lat.toFixed(5)}, ${lon.toFixed(5)} (outside UTM)`;
      return `${utm.zone}${utm.band} ${Math.round(utm.easting)}E ${Math.round(utm.northing)}N`;
    }
    default:
      return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
}

export const COORDINATE_FORMAT_LABELS: Record<CoordinateFormat, string> = {
  decimal: 'DD',
  dms: 'DMS',
  utm: 'UTM',
};

const NEXT_FORMAT: Record<CoordinateFormat, CoordinateFormat> = {
  decimal: 'dms',
  dms: 'utm',
  utm: 'decimal',
};

export function nextCoordinateFormat(format: CoordinateFormat): CoordinateFormat {
  return NEXT_FORMAT[format];
}
