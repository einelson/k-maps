import {
  DEFAULT_FIX_EVERY_M,
  DEFAULT_FIX_SPACING_M,
  MAX_FIX_EVERY_M,
  MIN_FIX_EVERY_M,
  SPACING_STEPS_M,
  TRANSPORT_MODES,
  clampSpacing,
  fixEveryM,
  parseTransport,
  stepSpacing,
  transportLabel,
  transportMode,
} from './transport';

describe('transport modes', () => {
  it('has unique ids and labels, and covers foot, horse and vehicle', () => {
    expect(new Set(TRANSPORT_MODES.map((m) => m.id)).size).toBe(TRANSPORT_MODES.length);
    expect(new Set(TRANSPORT_MODES.map((m) => m.label)).size).toBe(TRANSPORT_MODES.length);
    expect(TRANSPORT_MODES.map((m) => m.id)).toEqual(expect.arrayContaining(['foot', 'horse', 'vehicle']));
  });

  it('looks modes up by id and returns null for anything else', () => {
    expect(transportMode('horse')?.label).toBe('Horse');
    expect(transportMode('jetpack')).toBeNull();
    expect(transportMode(null)).toBeNull();
    expect(transportMode(undefined)).toBeNull();
    expect(transportLabel('atv')).toBe('ATV / UTV');
    expect(transportLabel('nope')).toBeNull();
  });

  it('samples on foot as tightly as tracks always were, and faster things less often', () => {
    expect(fixEveryM('foot')).toBe(5);
    expect(DEFAULT_FIX_EVERY_M).toBe(5); // no mode chosen, or a recording from before modes existed
    expect(fixEveryM(null)).toBe(DEFAULT_FIX_EVERY_M);
    expect(fixEveryM('unknown')).toBe(DEFAULT_FIX_EVERY_M);
    expect(fixEveryM('vehicle')).toBeGreaterThan(fixEveryM('atv'));
    expect(fixEveryM('atv')).toBeGreaterThan(fixEveryM('horse'));
    expect(fixEveryM('horse')).toBeGreaterThan(fixEveryM('foot'));
  });
});

describe('parseTransport', () => {
  it('reads our own ids and the GPX types we write, so an export imports back to the same mode', () => {
    for (const mode of TRANSPORT_MODES) {
      expect(parseTransport(mode.id)).toBe(mode.id);
      expect(parseTransport(mode.gpxType)).toBe(mode.id);
    }
  });

  it.each([
    ['Hiking', 'foot'],
    ['Trail Running', 'foot'],
    ['walking', 'foot'],
    ['Horseback riding', 'horse'],
    ['Equestrian', 'horse'],
    ['Cycling', 'bike'],
    ['Mountain Bike', 'bike'],
    ['MTB', 'bike'],
    ['Dirt bike', 'atv'], // more specific than "bike"
    ['UTV', 'atv'],
    ['Side-by-side', 'atv'],
    ['Off-road', 'atv'],
    ['Driving', 'vehicle'],
    ['4x4 truck', 'vehicle'],
    ['Motorcycle', 'vehicle'],
    ['Kayak', 'boat'],
    ['canoeing', 'boat'],
  ])('reads "%s" as %s', (text, id) => {
    expect(parseTransport(text)).toBe(id);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(parseTransport('  HORSE  ')).toBe('horse');
  });

  it('gives null for blanks, numeric activity codes and words it does not know, rather than guessing', () => {
    expect(parseTransport(null)).toBeNull();
    expect(parseTransport(undefined)).toBeNull();
    expect(parseTransport('   ')).toBeNull();
    expect(parseTransport('1')).toBeNull(); // Strava writes numeric codes
    expect(parseTransport('Trip to grandma')).toBeNull();
    expect(parseTransport('jetpack')).toBeNull();
  });

  it('does not read "run" out of the middle of a word', () => {
    expect(parseTransport('brunch')).toBeNull();
  });
});

describe('spacing setting', () => {
  it('defaults to what each mode records at', () => {
    expect(DEFAULT_FIX_SPACING_M).toEqual({ foot: 5, horse: 10, bike: 10, atv: 15, vehicle: 25, boat: 25, other: 10 });
  });

  it('uses the person\'s spacing for a mode when they set one, and the default otherwise', () => {
    expect(fixEveryM('horse', { horse: 20 })).toBe(20);
    expect(fixEveryM('horse', { foot: 2 })).toBe(10);
    expect(fixEveryM('horse', {})).toBe(10);
    expect(fixEveryM('horse', undefined)).toBe(10);
  });

  it('falls back to the standard 5 m when no mode is chosen, whatever was customised', () => {
    expect(fixEveryM(null, { foot: 50 })).toBe(DEFAULT_FIX_EVERY_M);
  });

  it('never hands the GPS a spacing outside what it can use', () => {
    expect(fixEveryM('foot', { foot: 0 })).toBe(MIN_FIX_EVERY_M);
    expect(fixEveryM('foot', { foot: -3 })).toBe(MIN_FIX_EVERY_M);
    expect(fixEveryM('foot', { foot: 5000 })).toBe(MAX_FIX_EVERY_M);
    expect(clampSpacing(7.5)).toBe(7.5);
  });

  it('has an ascending ladder that includes every default, so a default is always a step you can land on', () => {
    expect([...SPACING_STEPS_M].sort((a, b) => a - b)).toEqual(SPACING_STEPS_M);
    for (const value of Object.values(DEFAULT_FIX_SPACING_M)) expect(SPACING_STEPS_M).toContain(value);
  });

  it('steps up and down the ladder, and stops at the ends', () => {
    expect(stepSpacing(5, 1)).toBe(8);
    expect(stepSpacing(5, -1)).toBe(3);
    expect(stepSpacing(MAX_FIX_EVERY_M, 1)).toBe(MAX_FIX_EVERY_M);
    expect(stepSpacing(MIN_FIX_EVERY_M, -1)).toBe(MIN_FIX_EVERY_M);
  });

  it('steps from a value that is between steps to the nearest step in that direction', () => {
    expect(stepSpacing(6, 1)).toBe(8);
    expect(stepSpacing(6, -1)).toBe(5);
    expect(stepSpacing(4.6, 1)).toBe(5);
    expect(stepSpacing(4.6, -1)).toBe(3);
  });

  it('can step through the whole ladder one at a time', () => {
    let value = MIN_FIX_EVERY_M;
    const seen = [value];
    while (stepSpacing(value, 1) !== value) seen.push((value = stepSpacing(value, 1)));
    expect(seen).toEqual(SPACING_STEPS_M);
  });
});
