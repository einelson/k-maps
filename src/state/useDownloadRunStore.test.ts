import { useDownloadRunStore } from './useDownloadRunStore';

const store = useDownloadRunStore;

beforeEach(() => store.getState().dismiss());

describe('useDownloadRunStore', () => {
  it('starts idle', () => {
    expect(store.getState()).toMatchObject({ status: 'idle', total: 0, done: 0, failures: [] });
  });

  it('counts jobs as they finish and keeps every failure', () => {
    const s = store.getState();
    s.begin(3, 2);
    s.start('Public land · 43.6°N 116.2°W');
    s.progress(0.4);
    expect(store.getState()).toMatchObject({
      status: 'running',
      total: 3,
      skipped: 2,
      currentLabel: 'Public land · 43.6°N 116.2°W',
      currentFraction: 0.4,
    });

    s.jobDone(null);
    s.start('Topo');
    s.jobDone({ label: 'Topo', message: 'HTTP 500' });

    expect(store.getState().done).toBe(2);
    expect(store.getState().failures).toEqual([{ label: 'Topo', message: 'HTTP 500' }]);
  });

  it('keeps the result on screen after finishing, until dismissed', () => {
    const s = store.getState();
    s.begin(1, 0);
    s.jobDone(null);
    s.finish(true);
    expect(store.getState()).toMatchObject({ status: 'finished', cancelled: true, done: 1, currentLabel: null });

    s.dismiss();
    expect(store.getState().status).toBe('idle');
  });

  it('a new run forgets the last one', () => {
    const s = store.getState();
    s.begin(1, 0);
    s.jobDone({ label: 'x', message: 'y' });
    s.finish(false);

    s.begin(5, 0);
    expect(store.getState()).toMatchObject({ status: 'running', total: 5, done: 0, failures: [], cancelled: false });
  });

  it('keeps progress within 0..1', () => {
    store.getState().progress(3);
    expect(store.getState().currentFraction).toBe(1);
    store.getState().progress(-1);
    expect(store.getState().currentFraction).toBe(0);
  });
});
