import type { DownloadJob } from './downloadPlan';
import { runDownload, type RunJob, type RunReport } from './downloadRunner';

const job = (n: number, layer: DownloadJob['layer'] = 'land'): DownloadJob => ({
  kind: 'pack',
  layer,
  cx: n,
  cy: 0,
});

function recorder() {
  const events: string[] = [];
  const report: RunReport = {
    onJobStart: (j, i) => events.push(`start ${i}:${j.cx}`),
    onJobProgress: (j, f) => events.push(`progress ${j.cx}:${f}`),
    onJobDone: (j, failure) => events.push(`done ${j.cx}${failure ? ` failed(${failure.message})` : ''}`),
  };
  return { events, report };
}

describe('runDownload', () => {
  it('runs the jobs in order and reports each one', async () => {
    const { events, report } = recorder();
    const run: RunJob = async (_job, _signal, onProgress) => onProgress(0.5);

    const result = await runDownload([job(1), job(2)], run, report, new AbortController().signal);

    expect(result).toEqual({ completed: 2, failed: [], cancelled: false });
    expect(events).toEqual(['start 0:1', 'progress 1:0.5', 'done 1', 'start 1:2', 'progress 2:0.5', 'done 2']);
  });

  it('keeps going after a job fails, and remembers why', async () => {
    const { events, report } = recorder();
    const run: RunJob = async (j) => {
      if (j.cx === 2) throw new Error('HTTP 503');
    };

    const result = await runDownload([job(1), job(2), job(3)], run, report, new AbortController().signal);

    expect(result.completed).toBe(2);
    expect(result.cancelled).toBe(false);
    expect(result.failed).toEqual([{ job: job(2), message: 'HTTP 503' }]);
    expect(events).toContain('done 2 failed(HTTP 503)');
    expect(events).toContain('start 2:3');
  });

  it('turns a thrown non-Error into a message', async () => {
    const run: RunJob = async () => {
      throw 'boom';
    };
    const result = await runDownload([job(1)], run, recorder().report, new AbortController().signal);
    expect(result.failed[0].message).toBe('boom');
  });

  it('cancelling between jobs stops there without starting the next', async () => {
    const controller = new AbortController();
    const { events, report } = recorder();
    const run: RunJob = async (j) => {
      if (j.cx === 1) controller.abort();
    };

    const result = await runDownload([job(1), job(2)], run, report, controller.signal);

    expect(result.cancelled).toBe(true);
    expect(result.completed).toBe(0); // the one that was running when cancelled doesn't count as finished
    expect(events.some((e) => e.startsWith('start 1'))).toBe(false);
    expect(events).not.toContain('done 1');
  });

  it('an abort thrown by a job is a cancel, not a failure', async () => {
    const controller = new AbortController();
    const run: RunJob = async () => {
      controller.abort();
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    };

    const result = await runDownload([job(1), job(2)], run, recorder().report, controller.signal);

    expect(result).toEqual({ completed: 0, failed: [], cancelled: true });
  });

  it('treats an AbortError as a cancel even if the signal was not the one that fired', async () => {
    const run: RunJob = async () => {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    };
    const result = await runDownload([job(1)], run, recorder().report, new AbortController().signal);
    expect(result.cancelled).toBe(true);
    expect(result.failed).toEqual([]);
  });

  it('does nothing for no jobs', async () => {
    const { events, report } = recorder();
    expect(await runDownload([], async () => {}, report, new AbortController().signal)).toEqual({
      completed: 0,
      failed: [],
      cancelled: false,
    });
    expect(events).toEqual([]);
  });

  it('does not start when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const run = jest.fn();
    const result = await runDownload([job(1)], run, recorder().report, controller.signal);
    expect(run).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(true);
  });
});
