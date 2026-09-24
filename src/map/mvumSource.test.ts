import {
  MVUM_CLASS_COLORS,
  MVUM_CLASS_LABELS,
  MVUM_COLOR_EXPRESSION,
  MVUM_DATA,
  mvumVehicleClass,
  type MvumVehicleClass,
} from './mvumSource';

describe('mvumVehicleClass', () => {
  it('is "passenger" for passenger-open roads at maintenance level 3 and above', () => {
    for (const level of ['3 - SUITABLE FOR PASSENGER CARS', '4 - MODERATE DEGREE OF USER COMFORT', '5 - HIGH DEGREE OF USER COMFORT']) {
      expect(mvumVehicleClass({ passengervehicle: 'open', operationalmaintlevel: level })).toBe('passenger');
    }
  });

  it('downgrades passenger-open level 2 roads to "highClearance" (USFS: level 2 = high clearance)', () => {
    expect(
      mvumVehicleClass({ passengervehicle: 'open', operationalmaintlevel: '2 - HIGH CLEARANCE VEHICLES' })
    ).toBe('highClearance');
  });

  it('also treats level 1 (custodial care) and 0 as not passenger-friendly', () => {
    expect(mvumVehicleClass({ passengervehicle: 'open', operationalmaintlevel: '1 - BASIC CUSTODIAL CARE (CLOSED)' })).toBe(
      'highClearance'
    );
    expect(mvumVehicleClass({ passengervehicle: 'open', operationalmaintlevel: '0' })).toBe('highClearance');
  });

  it('claims passenger when the maintenance level is missing or unparseable (e.g. trails)', () => {
    expect(mvumVehicleClass({ passengervehicle: 'open' })).toBe('passenger');
    expect(mvumVehicleClass({ passengervehicle: 'open', operationalmaintlevel: null })).toBe('passenger');
    expect(mvumVehicleClass({ passengervehicle: 'open', operationalmaintlevel: '' })).toBe('passenger');
    expect(mvumVehicleClass({ passengervehicle: 'open', operationalmaintlevel: 'N/A' })).toBe('passenger');
  });

  it('accepts a numeric maintenance level as well as the text form', () => {
    expect(mvumVehicleClass({ passengervehicle: 'open', operationalmaintlevel: 3 })).toBe('passenger');
    expect(mvumVehicleClass({ passengervehicle: 'open', operationalmaintlevel: 2 })).toBe('highClearance');
  });

  it('is "highClearance" when high-clearance or truck use is open but passenger cars are not', () => {
    expect(mvumVehicleClass({ highclearancevehicle: 'open' })).toBe('highClearance');
    expect(mvumVehicleClass({ truck: 'open' })).toBe('highClearance');
    expect(mvumVehicleClass({ passengervehicle: 'closed', highclearancevehicle: 'open' })).toBe('highClearance');
  });

  it('is "offroad" when only ATV / motorcycle use is open', () => {
    expect(mvumVehicleClass({ atv: 'open' })).toBe('offroad');
    expect(mvumVehicleClass({ motorcycle: 'open' })).toBe('offroad');
    expect(mvumVehicleClass({ passengervehicle: 'closed', atv: 'open', motorcycle: 'open' })).toBe('offroad');
  });

  it('prefers the more capable-vehicle class when several apply (passenger > highClearance > offroad)', () => {
    expect(mvumVehicleClass({ passengervehicle: 'open', atv: 'open', operationalmaintlevel: '3' })).toBe('passenger');
    expect(mvumVehicleClass({ highclearancevehicle: 'open', atv: 'open' })).toBe('highClearance');
  });

  it('is "unknown" when nothing is open or the record is empty', () => {
    expect(mvumVehicleClass({})).toBe('unknown');
    expect(mvumVehicleClass({ passengervehicle: 'closed', atv: 'closed', truck: 'closed' })).toBe('unknown');
    expect(mvumVehicleClass({ passengervehicle: null, atv: undefined })).toBe('unknown');
  });

  it('only "open" counts (not "Open", "yes", or seasonal text)', () => {
    expect(mvumVehicleClass({ passengervehicle: 'Open' })).toBe('unknown');
    expect(mvumVehicleClass({ atv: 'yes' })).toBe('unknown');
  });
});

describe('MVUM styling tables', () => {
  const classes: MvumVehicleClass[] = ['passenger', 'highClearance', 'offroad', 'unknown'];

  it('has a label and a hex colour for every vehicle class, all distinct colours', () => {
    for (const c of classes) {
      expect(MVUM_CLASS_LABELS[c]).toEqual(expect.any(String));
      expect(MVUM_CLASS_COLORS[c]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(new Set(classes.map((c) => MVUM_CLASS_COLORS[c])).size).toBe(classes.length);
  });

  it('colour expression matches on the derived vehicleClass with "unknown" as the fallback', () => {
    expect(MVUM_COLOR_EXPRESSION as unknown).toEqual([
      'match',
      ['get', 'vehicleClass'],
      'passenger',
      MVUM_CLASS_COLORS.passenger,
      'highClearance',
      MVUM_CLASS_COLORS.highClearance,
      'offroad',
      MVUM_CLASS_COLORS.offroad,
      MVUM_CLASS_COLORS.unknown,
    ]);
  });
});

describe('MVUM_DATA (bundled asset with derived classes)', () => {
  it('stamps every feature with a known vehicleClass matching its own properties', () => {
    expect(MVUM_DATA.type).toBe('FeatureCollection');
    expect(MVUM_DATA.features.length).toBeGreaterThan(0);
    for (const feature of MVUM_DATA.features.slice(0, 500)) {
      const props = feature.properties as Record<string, unknown>;
      expect(Object.keys(MVUM_CLASS_LABELS)).toContain(props.vehicleClass);
      expect(props.vehicleClass).toBe(mvumVehicleClass(props));
    }
  });
});
