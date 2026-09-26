/**
 * The 50 states, with the id each one has as a region pack (`idaho`, `new-york`) — the same ids
 * tools/build_region_pack.mjs publishes in the manifest, so the app can line a state on the map up with its pack.
 *
 * Pure (no native modules): shared by the app and the build tools, which load it with node's type stripping.
 * DC is left out: its three cells are all shared with Maryland and Virginia.
 */

export interface UsState {
  /** Two-letter postal code. */
  code: string;
  name: string;
  /** Region pack id: the lower-cased name with dashes. */
  id: string;
}

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

/** Alphabetical by name. */
export const US_STATES: readonly UsState[] = Object.entries(STATE_NAMES)
  .map(([code, name]) => ({ code, name, id: name.toLowerCase().replace(/ /g, '-') }))
  .sort((a, b) => a.name.localeCompare(b.name));
