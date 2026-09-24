import { mvumVehicleClass } from './mvumClass.ts';

describe('mvumVehicleClass', () => {
  it('passenger for open passenger roads at maintenance level 3+ or unknown level', () => {
    expect(mvumVehicleClass({ passengervehicle: 'open', operationalmaintlevel: '3 - SUITABLE FOR PASSENGER CARS' })).toBe('passenger');
    expect(mvumVehicleClass({ passengervehicle: 'open', operationalmaintlevel: '5 - HIGH DEGREE OF USER COMFORT' })).toBe('passenger');
    expect(mvumVehicleClass({ passengervehicle: 'open' })).toBe('passenger');
  });

  it('level 1-2 roads are high clearance even when passenger vehicles are legally open', () => {
    expect(mvumVehicleClass({ passengervehicle: 'open', operationalmaintlevel: '2 - HIGH CLEARANCE VEHICLES' })).toBe('highClearance');
    expect(mvumVehicleClass({ passengervehicle: 'open', operationalmaintlevel: '1 - BASIC CUSTODIAL CARE (CLOSED)' })).toBe('highClearance');
  });

  it('high clearance / truck designations', () => {
    expect(mvumVehicleClass({ highclearancevehicle: 'open' })).toBe('highClearance');
    expect(mvumVehicleClass({ truck: 'open', atv: 'open' })).toBe('highClearance');
  });

  it('off-road only when just ATV / motorcycle are open', () => {
    expect(mvumVehicleClass({ atv: 'open' })).toBe('offroad');
    expect(mvumVehicleClass({ motorcycle: 'open', passengervehicle: 'closed' })).toBe('offroad');
  });

  it('unknown otherwise', () => {
    expect(mvumVehicleClass({})).toBe('unknown');
    expect(mvumVehicleClass({ passengervehicle: 'closed', atv: 'closed' })).toBe('unknown');
  });
});
