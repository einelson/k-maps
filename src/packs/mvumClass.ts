/**
 * Pure classification of USFS MVUM road/trail attributes into a coarse
 * "what can I drive here" class. No map/UI imports so it runs in the pack
 * fetcher (node + Hermes) as well as the app.
 */

export type MvumVehicleClass = 'passenger' | 'highClearance' | 'offroad' | 'unknown';

/** Leading digit of `operationalmaintlevel` ("2 - HIGH CLEARANCE VEHICLES" -> 2). Roads only; trails have none. */
function maintenanceLevel(props: Record<string, unknown>): number | null {
  const level = Number.parseInt(String(props.operationalmaintlevel ?? ''), 10);
  return Number.isNaN(level) ? null : level;
}

/**
 * "Can I drive my vehicle here" classification. The per-vehicle-type fields are legal
 * designations, and `passengervehicle` is `open` on nearly every road — including maintenance
 * level 2 roads, which the Forest Service defines as high-clearance. So passenger is only
 * claimed for level 3+ (or when the level is missing).
 */
export function mvumVehicleClass(props: Record<string, unknown>): MvumVehicleClass {
  const level = maintenanceLevel(props);
  const highClearanceRoad = level !== null && level <= 2;
  if (props.passengervehicle === 'open' && !highClearanceRoad) return 'passenger';
  if (
    props.passengervehicle === 'open' ||
    props.highclearancevehicle === 'open' ||
    props.truck === 'open'
  ) {
    return 'highClearance';
  }
  if (props.atv === 'open' || props.motorcycle === 'open') return 'offroad';
  return 'unknown';
}
