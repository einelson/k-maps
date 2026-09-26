import { US_STATES } from '../packs/usStates';
import { createStateIndex, US_STATE_CELLS, viewFitting } from './stateCells';
import { US_COVERAGE } from './usCells';

const states = [
  { code: 'AA', name: 'Aland', id: 'aland' },
  { code: 'BB', name: 'Bland', id: 'bland' },
  { code: 'CC', name: 'Cland', id: 'cland' },
];
// AA and BB share the cell 2:1 (a cell on the line between them).
const index = createStateIndex(
  {
    AA: [
      [1, 1],
      [2, 1],
    ],
    BB: [
      [2, 1],
      [3, 1],
    ],
    CC: [[9, 9]],
  },
  states
);
const c = (cx: number, cy: number) => ({ cx, cy });
const keys = (cells: readonly { cx: number; cy: number }[]) => cells.map(({ cx, cy }) => `${cx}:${cy}`).sort();

describe('createStateIndex', () => {
  it('lists a state’s cells, and nothing for an unknown state', () => {
    expect(keys(index.cellsOf('AA'))).toEqual(['1:1', '2:1']);
    expect(index.cellsOf('ZZ')).toEqual([]);
  });

  it('says which states a cell is in — two on a state line, none in the ocean', () => {
    expect(index.statesOfCell(1, 1).map((s) => s.code)).toEqual(['AA']);
    expect(index.statesOfCell(2, 1).map((s) => s.code)).toEqual(['AA', 'BB']);
    expect(index.statesOfCell(50, 50)).toEqual([]);
  });

  it('finds the states that are picked whole, not just touched', () => {
    expect(index.wholeStates([])).toEqual([]);
    expect(index.wholeStates([c(1, 1)])).toEqual([]);
    expect(index.wholeStates([c(1, 1), c(2, 1)]).map((s) => s.code)).toEqual(['AA']);
    expect(index.wholeStates([c(1, 1), c(2, 1), c(3, 1), c(9, 9)]).map((s) => s.code)).toEqual(['AA', 'BB', 'CC']);
  });

  it('adds a state’s cells without doubling up ones already picked', () => {
    const picked = index.addState([c(2, 1), c(7, 7)], 'AA');
    expect(keys(picked)).toEqual(['1:1', '2:1', '7:7']);
    expect(index.wholeStates(picked).map((s) => s.code)).toEqual(['AA']);
  });

  it('removes a state’s cells but leaves loose picks alone', () => {
    const picked = index.addState([c(7, 7)], 'AA');
    expect(keys(index.removeState(picked, 'AA'))).toEqual(['7:7']);
  });

  it('keeps a shared line cell while the neighbouring state is still picked whole', () => {
    const both = index.addState(index.addState([], 'AA'), 'BB');
    const withoutA = index.removeState(both, 'AA');
    expect(keys(withoutA)).toEqual(['2:1', '3:1']);
    expect(index.wholeStates(withoutA).map((s) => s.code)).toEqual(['BB']);
  });

  it('draws the bounds around the state’s cells', () => {
    const [west, south, east, north] = index.boundsOf('AA')!;
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);
    expect(index.boundsOf('ZZ')).toBeNull();
  });
});

describe('the bundled state data', () => {
  it('has all 50 states, none of them empty', () => {
    expect(US_STATES).toHaveLength(50);
    for (const { code } of US_STATES) expect(US_STATE_CELLS.cellsOf(code).length).toBeGreaterThan(0);
  });

  it('matches what the pack builder was told about Idaho (329 cells)', () => {
    expect(US_STATE_CELLS.cellsOf('ID')).toHaveLength(329);
  });

  it('only lists cells that hold US land, so picking a state never trips the no-land check', () => {
    for (const { code } of US_STATES) {
      for (const { cx, cy } of US_STATE_CELLS.cellsOf(code)) {
        expect(US_COVERAGE.hasLand(cx, cy)).toBe(true);
      }
    }
  });

  it('puts every cell of the Idaho / Washington line in both states', () => {
    const idaho = new Set(keys(US_STATE_CELLS.cellsOf('ID')));
    const shared = US_STATE_CELLS.cellsOf('WA').filter(({ cx, cy }) => idaho.has(`${cx}:${cy}`));
    expect(shared.length).toBeGreaterThan(0);
    for (const { cx, cy } of shared) {
      expect(US_STATE_CELLS.statesOfCell(cx, cy).map((s) => s.code)).toEqual(expect.arrayContaining(['ID', 'WA']));
    }
  });

  it('flies to a box around the main body of Alaska, not the whole world (the Aleutians cross the antimeridian)', () => {
    const [west, , east] = US_STATE_CELLS.boundsOf('AK')!;
    expect(west).toBeGreaterThanOrEqual(-180);
    expect(east).toBeLessThan(-100);
  });

  it('every state id is a plain lower-case slug, like the region packs use', () => {
    for (const { id } of US_STATES) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(US_STATES.find((s) => s.code === 'NY')?.id).toBe('new-york');
  });
});

describe('viewFitting', () => {
  const phone = { width: 360, height: 260 };

  it('centres on the box', () => {
    const { center } = viewFitting([-117.3, 42, -111, 49], phone);
    expect(center[0]).toBeCloseTo(-114.15);
    expect(center[1]).toBeGreaterThan(42);
    expect(center[1]).toBeLessThan(49);
  });

  it('zooms so the box fits with the margin: wider than tall is limited by width, taller than wide by height', () => {
    const wide = viewFitting([-120, 40, -110, 41], phone, 0);
    expect(wide.zoom).toBeCloseTo(Math.log2(360 / (512 * (10 / 360))), 5);
    const tall = viewFitting([-120, 30, -119, 50], phone, 0);
    expect(tall.zoom).toBeLessThan(wide.zoom);
  });

  it('a bigger state is zoomed out further than a small one', () => {
    const idaho = viewFitting(US_STATE_CELLS.boundsOf('ID')!, phone);
    const rhodeIsland = viewFitting(US_STATE_CELLS.boundsOf('RI')!, phone);
    expect(idaho.zoom).toBeLessThan(rhodeIsland.zoom);
    expect(idaho.zoom).toBeGreaterThan(3);
    expect(idaho.zoom).toBeLessThan(7);
  });

  it('shows all of a state at the zoom it picks: the bounds fit inside the map', () => {
    const [west, south, east, north] = US_STATE_CELLS.boundsOf('CO')!;
    const { zoom } = viewFitting([west, south, east, north], phone);
    const widthDp = ((east - west) / 360) * 512 * 2 ** zoom;
    expect(widthDp).toBeLessThanOrEqual(phone.width);
  });

  it('gives a usable view for a degenerate box', () => {
    const { zoom } = viewFitting([-100, 40, -100, 40], phone);
    expect(Number.isFinite(zoom)).toBe(true);
  });
});
