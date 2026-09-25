import type { HuntUnitPackEntry } from '../packs/regionPacks';
import type { InstalledHuntState } from '../state/useHuntUnitStore';
import { huntUnitStatus } from './huntUnitStatus';

const pack = { state: 'OR', version: 'v2' } as HuntUnitPackEntry;
const record = (version: string) => ({ state: 'OR', version }) as InstalledHuntState;

describe('huntUnitStatus', () => {
  it('none when never installed', () => {
    expect(huntUnitStatus(pack, undefined, false)).toBe('none');
    expect(huntUnitStatus(pack, undefined, true)).toBe('none');
  });

  it('none when the record survives but the file is gone (cleared storage): download again', () => {
    expect(huntUnitStatus(pack, record('v2'), false)).toBe('none');
  });

  it('installed when the version matches, update when a newer one is published', () => {
    expect(huntUnitStatus(pack, record('v2'), true)).toBe('installed');
    expect(huntUnitStatus(pack, record('v1'), true)).toBe('update');
  });
});
