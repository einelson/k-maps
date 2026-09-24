import {
  COORDINATE_FORMAT_LABELS,
  formatCoordinate,
  nextCoordinateFormat,
  toUtm,
} from './coordinates';

/**
 * Reference values below were computed independently of the implementation
 * (Snyder, USGS PP 1395 eq. 8-9..8-15 on WGS84, k0 = 0.9996), not with the
 * Krüger series used by `toUtm`, so they catch formula mistakes rather than
 * echoing them. Tolerance is 1 m.
 */
function expectUtm(
  actual: ReturnType<typeof toUtm>,
  expected: { zone: number; band: string; easting: number; northing: number }
) {
  expect(actual).not.toBeNull();
  expect(actual!.zone).toBe(expected.zone);
  expect(actual!.band).toBe(expected.band);
  expect(Math.abs(actual!.easting - expected.easting)).toBeLessThan(1);
  expect(Math.abs(actual!.northing - expected.northing)).toBeLessThan(1);
}

describe('toUtm reference points', () => {
  it('puts the equator at the central meridian at exactly 500000E 0N', () => {
    // Zone 31 central meridian is 3°E.
    const utm = toUtm(3, 0)!;
    expect(utm.zone).toBe(31);
    expect(utm.band).toBe('N');
    expect(utm.easting).toBeCloseTo(500000, 6);
    expect(utm.northing).toBeCloseTo(0, 6);
  });

  it('gives the scaled meridian arc length for 45°N on the central meridian', () => {
    // Zone 15 central meridian is 93°W; arc(45°) * 0.9996 = 4982950.40 m.
    const utm = toUtm(-93, 45)!;
    expect(utm.zone).toBe(15);
    expect(utm.easting).toBeCloseTo(500000, 6);
    expect(Math.abs(utm.northing - 4982950.4)).toBeLessThan(0.1);
  });

  it('Boise, Idaho (northern hemisphere, western zone)', () => {
    expectUtm(toUtm(-116.2023, 43.615), { zone: 11, band: 'T', easting: 564367.1, northing: 4829422.3 });
  });

  it('Mount Whitney, California', () => {
    expectUtm(toUtm(-118.2923, 36.5785), { zone: 11, band: 'S', easting: 384381.8, northing: 4048892.8 });
  });

  it('Empire State Building, New York', () => {
    expectUtm(toUtm(-73.985428, 40.748817), { zone: 18, band: 'T', easting: 585650.8, northing: 4511369.0 });
  });

  it('Eiffel Tower area, Paris (eastern hemisphere)', () => {
    expectUtm(toUtm(2.2945, 48.8584), { zone: 31, band: 'U', easting: 448252.0, northing: 5411954.9 });
  });

  it('Sydney (southern hemisphere adds the 10,000,000 m false northing)', () => {
    expectUtm(toUtm(151.2153, -33.8568), { zone: 56, band: 'H', easting: 334900.6, northing: 6252288.8 });
  });

  it('Cape Town (southern hemisphere, east of the equator)', () => {
    expectUtm(toUtm(18.4241, -33.9249), { zone: 34, band: 'H', easting: 261881.6, northing: 6243182.4 });
  });

  it('just south of the equator stays in the southern false-northing frame', () => {
    // Quito sits ~0.18°S: northing is just under 10,000,000, easting east of the zone-17 meridian.
    expectUtm(toUtm(-78.4678, -0.1807), { zone: 17, band: 'M', easting: 781861.5, northing: 9980007.6 });
  });

  it('easting is below 500000 west of the central meridian and above it east of it', () => {
    expect(toUtm(2, 45)!.easting).toBeLessThan(500000); // zone 31 CM = 3°E
    expect(toUtm(4, 45)!.easting).toBeGreaterThan(500000);
    // and symmetric about the central meridian
    const west = toUtm(2, 45)!.easting;
    const east = toUtm(4, 45)!.easting;
    expect(500000 - west).toBeCloseTo(east - 500000, 3);
  });

  it('northing on the same meridian grows monotonically with latitude', () => {
    let previous = -Infinity;
    for (let lat = -80; lat <= 84; lat += 4) {
      const northing = toUtm(-116.2, lat)!.northing;
      // Southern latitudes use the +1e7 false northing, so compare within a hemisphere.
      if (lat >= 0) {
        expect(northing).toBeGreaterThan(previous);
        previous = northing;
      }
    }
    previous = -Infinity;
    for (let lat = -80; lat < 0; lat += 4) {
      const northing = toUtm(-116.2, lat)!.northing;
      expect(northing).toBeGreaterThan(previous);
      previous = northing;
    }
  });
});

describe('toUtm coverage limits', () => {
  it('accepts exactly 80°S and 84°N', () => {
    expect(toUtm(0, -80)).not.toBeNull();
    expect(toUtm(0, 84)).not.toBeNull();
  });

  it('returns null beyond 80°S / 84°N (UPS territory)', () => {
    expect(toUtm(0, -80.0001)).toBeNull();
    expect(toUtm(0, 84.0001)).toBeNull();
    expect(toUtm(0, 90)).toBeNull();
    expect(toUtm(0, -90)).toBeNull();
  });
});

describe('UTM zone numbers', () => {
  const zoneAt = (lon: number, lat = 0) => toUtm(lon, lat)!.zone;

  it('starts at zone 1 at 180°W and ends at zone 60 just west of 180°E', () => {
    expect(zoneAt(-180)).toBe(1);
    expect(zoneAt(-174.0001)).toBe(1);
    expect(zoneAt(-174)).toBe(2);
    expect(zoneAt(179.9999)).toBe(60);
  });

  it('switches zones exactly on 6° boundaries (western edge inclusive)', () => {
    expect(zoneAt(-114.0001)).toBe(11);
    expect(zoneAt(-114)).toBe(12);
    expect(zoneAt(-0.0001)).toBe(30);
    expect(zoneAt(0)).toBe(31);
    expect(zoneAt(5.9999)).toBe(31);
    expect(zoneAt(6)).toBe(32);
  });

  it('applies the Norway exception (32V is widened to 3°E–12°E, 56°N–64°N)', () => {
    expect(zoneAt(5, 60)).toBe(32); // regular grid would say 31
    expect(zoneAt(3, 60)).toBe(32);
    expect(zoneAt(2.9999, 60)).toBe(31);
    expect(zoneAt(11.9999, 60)).toBe(32);
    expect(zoneAt(12, 60)).toBe(33);
    // outside the latitude window it is the regular grid again
    expect(zoneAt(5, 55.9999)).toBe(31);
    expect(zoneAt(5, 64)).toBe(31);
  });

  it('applies the Svalbard exceptions (zones 32X, 34X, 36X do not exist)', () => {
    expect(zoneAt(8, 75)).toBe(31); // regular grid: 32
    expect(zoneAt(10, 75)).toBe(33); // regular grid: 32
    expect(zoneAt(20, 75)).toBe(33); // regular grid: 34
    expect(zoneAt(30, 75)).toBe(35); // regular grid: 36
    expect(zoneAt(35, 75)).toBe(37); // regular grid: 36
    expect(zoneAt(41.9999, 75)).toBe(37);
    // below 72°N the regular grid applies
    expect(zoneAt(10, 71.9999)).toBe(32);
  });

  it('assigns latitudes at the top of the Svalbard band correctly', () => {
    expect(zoneAt(10, 83.9)).toBe(33);
  });

  it('near a Svalbard exception the easting stays within a plausible zone width', () => {
    // 10°E at 75°N lives in zone 33 (CM 15°E), so it is 5° west of the CM.
    const utm = toUtm(10, 75)!;
    expect(utm.zone).toBe(33);
    expect(utm.easting).toBeLessThan(500000);
    expect(utm.easting).toBeGreaterThan(300000);
  });
});

describe('UTM latitude bands', () => {
  const bandAt = (lat: number) => toUtm(0, lat)!.band;

  it('C at 80°S up to X at 84°N', () => {
    expect(bandAt(-80)).toBe('C');
    expect(bandAt(84)).toBe('X');
  });

  it('band boundaries fall every 8° starting at 80°S, and skip I and O', () => {
    expect(bandAt(-72.0001)).toBe('C');
    expect(bandAt(-72)).toBe('D');
    expect(bandAt(-0.0001)).toBe('M');
    expect(bandAt(0)).toBe('N');
    expect(bandAt(7.9999)).toBe('N');
    expect(bandAt(8)).toBe('P');
    expect(bandAt(40.7)).toBe('T');
    expect(bandAt(48)).toBe('U');
    expect(bandAt(56)).toBe('V');
    expect(bandAt(64)).toBe('W');
    expect(bandAt(72)).toBe('X');
    // Walking every band start must never yield the ambiguous letters I or O.
    for (let lat = -80; lat <= 84; lat += 1) {
      expect(['I', 'O']).not.toContain(bandAt(lat));
    }
  });

  it('band X is 12° tall (72°N–84°N)', () => {
    expect(bandAt(83.99)).toBe('X');
    expect(bandAt(72.5)).toBe('X');
  });
});

describe('formatCoordinate: decimal', () => {
  it('prints "lat, lon" with 5 decimal places', () => {
    expect(formatCoordinate(-116.2023, 43.615, 'decimal')).toBe('43.61500, -116.20230');
  });

  it('pads and rounds to 5 places', () => {
    expect(formatCoordinate(0, 0, 'decimal')).toBe('0.00000, 0.00000');
    expect(formatCoordinate(1.234567891, -2.000004, 'decimal')).toBe('-2.00000, 1.23457');
  });

  it('is the fallback for an unknown format value', () => {
    expect(formatCoordinate(10, 20, 'nonsense' as never)).toBe('20.00000, 10.00000');
  });
});

describe('formatCoordinate: DMS', () => {
  it('formats lat first then lon, with N/E for positive values', () => {
    // 43.615° = 43°36'54.0"; 116.2023° = 116°12'8.28" -> 08.3
    expect(formatCoordinate(116.2023, 43.615, 'dms')).toBe(`43°36'54.0"N 116°12'08.3"E`);
  });

  it('uses S and W hemispheres for negative values and prints absolute magnitudes', () => {
    expect(formatCoordinate(-116.2023, -43.615, 'dms')).toBe(`43°36'54.0"S 116°12'08.3"W`);
  });

  it('treats 0 as N/E', () => {
    expect(formatCoordinate(0, 0, 'dms')).toBe(`0°00'00.0"N 0°00'00.0"E`);
  });

  it('zero-pads minutes and seconds', () => {
    // 10° 05' 03.0"
    const lat = 10 + 5 / 60 + 3 / 3600;
    expect(formatCoordinate(0, lat, 'dms')).toBe(`10°05'03.0"N 0°00'00.0"E`);
  });

  it('prints whole degrees as ..°00\'00.0"', () => {
    expect(formatCoordinate(-45, 45, 'dms')).toBe(`45°00'00.0"N 45°00'00.0"W`);
  });

  it('carries when seconds round up to 60.0 (59.96" -> next minute)', () => {
    const lat = 10 + 59 / 60 + 59.96 / 3600;
    expect(formatCoordinate(0, lat, 'dms')).toBe(`11°00'00.0"N 0°00'00.0"E`);
  });

  it('carries a rounded-up minute into the degree', () => {
    expect(formatCoordinate(0, 0.99999999, 'dms')).toBe(`1°00'00.0"N 0°00'00.0"E`);
  });

  it('carries seconds into minutes without touching degrees when minutes stay below 60', () => {
    const lat = 20 + 30 / 60 + 59.99 / 3600;
    expect(formatCoordinate(0, lat, 'dms')).toBe(`20°31'00.0"N 0°00'00.0"E`);
  });

  it('never emits 60 in the minutes or seconds field across a sweep', () => {
    for (let i = 0; i < 600; i++) {
      const value = -180 + (360 * i) / 599 + 1e-7 * i;
      const text = formatCoordinate(value, value / 2, 'dms');
      const parts = [...text.matchAll(/(\d+)°(\d+)'(\d+\.\d)"/g)];
      expect(parts).toHaveLength(2);
      for (const [, , minutes, seconds] of parts) {
        expect(Number(minutes)).toBeLessThan(60);
        expect(Number(seconds)).toBeLessThan(60);
      }
    }
  });

  it('round-trips back to the input within 0.05" (~1.5 m)', () => {
    const parse = (s: string) => {
      const m = /(\d+)°(\d+)'(\d+\.\d)"([NSEW])/.exec(s)!;
      const abs = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
      return m[4] === 'S' || m[4] === 'W' ? -abs : abs;
    };
    for (const [lon, lat] of [
      [-116.2023, 43.615],
      [151.2153, -33.8568],
      [-0.1276, 51.5072],
      [179.999, -89.5],
    ]) {
      const [latText, lonText] = formatCoordinate(lon, lat, 'dms').split(' ');
      expect(Math.abs(parse(latText) - lat)).toBeLessThan(0.05 / 3600 + 1e-9);
      expect(Math.abs(parse(lonText) - lon)).toBeLessThan(0.05 / 3600 + 1e-9);
    }
  });
});

describe('formatCoordinate: UTM', () => {
  it('prints "<zone><band> <easting>E <northing>N" with integer metres', () => {
    expect(formatCoordinate(3, 0, 'utm')).toBe('31N 500000E 0N');
  });

  it('formats a real location', () => {
    const text = formatCoordinate(-116.2023, 43.615, 'utm');
    expect(text).toMatch(/^11T \d{6}E \d{7}N$/);
    const [, e, n] = /^11T (\d+)E (\d+)N$/.exec(text)!;
    expect(Math.abs(Number(e) - 564367)).toBeLessThanOrEqual(1);
    expect(Math.abs(Number(n) - 4829422)).toBeLessThanOrEqual(1);
  });

  it('formats southern hemisphere northings near 10,000,000 without a sign', () => {
    const text = formatCoordinate(-78.4678, -0.1807, 'utm');
    expect(text).toMatch(/^17M \d{6}E 99\d{5}N$/);
  });

  it('shows the lat/lon fallback outside UTM coverage', () => {
    expect(formatCoordinate(0, 85, 'utm')).toBe('85.00000, 0.00000 (outside UTM)');
    expect(formatCoordinate(-45, -85.5, 'utm')).toBe('-85.50000, -45.00000 (outside UTM)');
  });
});

describe('coordinate format cycling', () => {
  it('cycles decimal -> dms -> utm -> decimal', () => {
    expect(nextCoordinateFormat('decimal')).toBe('dms');
    expect(nextCoordinateFormat('dms')).toBe('utm');
    expect(nextCoordinateFormat('utm')).toBe('decimal');
  });

  it('has a short label for every format', () => {
    expect(COORDINATE_FORMAT_LABELS).toEqual({ decimal: 'DD', dms: 'DMS', utm: 'UTM' });
  });
});

describe('known issues', () => {
  // BUG (src/features/coordinates.ts:34): utmZoneNumber() does not wrap
  // longitudes, so exactly 180°E gives floor(360/6)+1 = zone 61, which does
  // not exist (and 190°E gives 62, etc.). Proposed fix: normalise first, e.g.
  //   const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  //   return Math.floor((wrapped + 180) / 6) + 1;
  // (or clamp with Math.min(60, ...) if only ±180 is expected). MapLibre can
  // report the map centre as ±180 near the antimeridian.
  it('never returns a zone above 60 at the antimeridian', () => {
    expect(toUtm(180, 0)!.zone).toBeLessThanOrEqual(60);
  });

  it('treats longitudes past 180° as wrapped', () => {
    // 190°E is 170°W -> zone 2.
    expect(toUtm(190, 0)!.zone).toBe(2);
  });
});
