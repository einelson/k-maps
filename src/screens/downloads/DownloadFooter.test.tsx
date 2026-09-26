import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { cancelDownload } from '../../downloads/startDownload';
import { useDownloadRunStore } from '../../state/useDownloadRunStore';
import { pressableWith, pressablesNamed, renderedTexts, settle } from '../../testing/renderHelpers';
import { DownloadFooter } from './DownloadFooter';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// The real starter pulls in the file system and SQLite; the footer only needs to be able to call Cancel.
jest.mock('../../downloads/startDownload', () => ({ cancelDownload: jest.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer;
const onRetry = jest.fn();
const reloadCoverage = jest.fn(async () => {});
const run = () => useDownloadRunStore.getState();
const texts = () => renderedTexts(renderer);
const has = (text: string) => texts().includes(text);
const hasMatch = (re: RegExp) => texts().some((t) => re.test(t));

function mount(props: Partial<Parameters<typeof DownloadFooter>[0]> = {}) {
  act(
    () =>
      void (renderer = create(
        <DownloadFooter
          blocked={null}
          jobCount={4}
          skipped={0}
          estimate={{ bytes: 3_000_000, packSeconds: 40 }}
          hasSelection
          onRetry={onRetry}
          reloadCoverage={reloadCoverage}
          {...props}
        />
      ))
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  act(() => run().dismiss());
});

describe('DownloadFooter before a download', () => {
  it('says there is nothing to download until something is picked, and explains why the header button is off', () => {
    mount({ hasSelection: false, jobCount: 0, blocked: 'Tap the map to pick an area first.' });

    expect(has('Nothing to download yet')).toBe(true);
    expect(has('Tap the map to pick an area first.')).toBe(true);
  });

  it('shows the size and, for land & trail data, how long it takes', () => {
    mount();

    expect(has('About 3.0 MB · under a minute for land & trail data')).toBe(true);
  });

  it('leaves the time out when only map pictures are chosen', () => {
    mount({ estimate: { bytes: 60_000_000, packSeconds: 0 } });

    expect(has('About 60 MB')).toBe(true);
  });

  it('says how much is skipped because it is already on the phone', () => {
    mount({ skipped: 3 });
    expect(has('3 already on this phone are skipped.')).toBe(true);

    act(() =>
      renderer.update(
        <DownloadFooter
          blocked={null}
          jobCount={4}
          skipped={1}
          estimate={{ bytes: 1, packSeconds: 0 }}
          hasSelection
          onRetry={onRetry}
          reloadCoverage={reloadCoverage}
        />
      )
    );
    expect(has('1 already on this phone is skipped.')).toBe(true);
  });

  it('warns when the download is very large', () => {
    mount({ estimate: { bytes: 4_500_000_000, packSeconds: 0 } });

    expect(has('About 4.5 GB')).toBe(true);
    expect(hasMatch(/That is a lot of storage/)).toBe(true);
  });

  it('shows the reason instead of the warning when it cannot start at all', () => {
    mount({
      estimate: { bytes: 4_500_000_000, packSeconds: 0 },
      blocked: 'Not enough space: this needs about 4.5 GB and the phone has 2.0 GB free.',
    });

    expect(hasMatch(/Not enough space/)).toBe(true);
    expect(hasMatch(/That is a lot of storage/)).toBe(false);
  });
});

describe('DownloadFooter while downloading', () => {
  it('shows which job it is on and what it is fetching, and Cancel stops it', () => {
    mount();
    act(() => {
      run().begin(10, 0);
      run().jobDone(null);
      run().jobDone(null);
      run().start('Public land · 43.6°N 116.2°W');
    });

    expect(has('Downloading 3 of 10')).toBe(true);
    expect(has('Public land · 43.6°N 116.2°W')).toBe(true);
    expect(hasMatch(/keeps going while K-Maps is open/)).toBe(true);
    act(() => pressableWith(renderer, 'Cancel').props.onPress());
    expect(cancelDownload).toHaveBeenCalledTimes(1);
  });

  it('never reads "11 of 10" when the last job is finishing', () => {
    mount();
    act(() => {
      run().begin(2, 0);
      run().jobDone(null);
      run().jobDone(null);
    });
    expect(has('Downloading 2 of 2')).toBe(true);
  });

  it('has no Download button of its own, before or during a download (it lives in the header)', () => {
    mount();
    expect(pressablesNamed(renderer, 'Download')).toHaveLength(0);
    act(() => run().begin(2, 0));
    expect(pressablesNamed(renderer, 'Download')).toHaveLength(0);
  });
});

describe('DownloadFooter after a download', () => {
  it('reports a clean finish, and OK returns to the picker', () => {
    mount();
    act(() => {
      run().begin(3, 0);
      for (let i = 0; i < 3; i++) run().jobDone(null);
      run().finish(false);
    });

    expect(has('Done — 3 saved to this phone')).toBe(true);
    act(() => pressableWith(renderer, 'OK').props.onPress());
    expect(run().status).toBe('idle');
    expect(has('Nothing to download yet') || hasMatch(/^About /)).toBe(true);
  });

  it('says it stopped, and that finished squares are kept, when cancelled', () => {
    mount();
    act(() => {
      run().begin(10, 0);
      for (let i = 0; i < 4; i++) run().jobDone(null);
      run().finish(true);
    });

    expect(has('Stopped — 4 of 10 saved')).toBe(true);
    expect(has('Finished squares are kept.')).toBe(true);
  });

  it('counts failures, hides the reasons until asked, and offers to retry what is missing', () => {
    mount();
    act(() => {
      run().begin(4, 0);
      run().jobDone(null);
      run().jobDone({ label: 'Public land · 44.0°N 116.0°W', message: 'HTTP 503 from geo.dot.gov' });
      run().jobDone(null);
      run().jobDone({ label: 'Topo · 44.3°N 116.0°W', message: 'Network request failed' });
      run().finish(false);
    });

    expect(has('2 saved, 2 failed')).toBe(true);
    expect(hasMatch(/HTTP 503/)).toBe(false);

    act(() => pressableWith(renderer, 'Show what failed').props.onPress());
    expect(has('Public land · 44.0°N 116.0°W: HTTP 503 from geo.dot.gov')).toBe(true);
    expect(has('Topo · 44.3°N 116.0°W: Network request failed')).toBe(true);

    act(() => pressableWith(renderer, 'Hide details').props.onPress());
    expect(hasMatch(/HTTP 503/)).toBe(false);

    act(() => pressableWith(renderer, /Retry/).props.onPress());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not offer a retry that could not start (for example, no space left)', () => {
    mount({ blocked: 'Not enough space.' });
    act(() => {
      run().begin(1, 0);
      run().jobDone({ label: 'x', message: 'y' });
      run().finish(false);
    });

    expect(() => pressableWith(renderer, /Retry/)).toThrow();
  });

  it('caps a long failure list', () => {
    mount();
    act(() => {
      run().begin(30, 0);
      for (let i = 0; i < 30; i++) run().jobDone({ label: `Job ${i}`, message: 'boom' });
      run().finish(false);
    });
    act(() => pressableWith(renderer, 'Show what failed').props.onPress());

    expect(has('Job 19: boom')).toBe(true);
    expect(has('Job 20: boom')).toBe(false);
    expect(has('…and 10 more')).toBe(true);
  });

  it('re-reads what is on the phone once it finishes, so the map shows the new squares', async () => {
    mount();
    act(() => {
      run().begin(1, 0);
      run().jobDone(null);
      run().finish(false);
    });
    await settle();

    expect(reloadCoverage).toHaveBeenCalled();
  });
});
