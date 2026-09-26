/**
 * Runs a list of download jobs one after another, reporting as it goes. The network and disk work is
 * handed in (`run`), so this is just the bookkeeping that has to be right: cancelling stops cleanly and
 * isn't reported as a failure, one failed job doesn't stop the rest, and every failure keeps its reason.
 *
 * Pure (no React, no native modules) so it is unit-testable; src/downloads/startDownload.ts wires it up.
 */

import { isAbortError } from '../packs/http';
import type { DownloadJob } from './downloadPlan';

export interface JobFailure {
  job: DownloadJob;
  message: string;
}

export interface RunReport {
  onJobStart: (job: DownloadJob, index: number) => void;
  /** Fraction of the current job, 0..1. */
  onJobProgress: (job: DownloadJob, fraction: number) => void;
  /** Called after each job that finished (not for one cut short by cancelling). */
  onJobDone: (job: DownloadJob, failure: JobFailure | null) => void;
}

export interface RunResult {
  completed: number;
  failed: JobFailure[];
  cancelled: boolean;
}

export type RunJob = (job: DownloadJob, signal: AbortSignal, onProgress: (fraction: number) => void) => Promise<void>;

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function runDownload(
  jobs: readonly DownloadJob[],
  run: RunJob,
  report: RunReport,
  signal: AbortSignal
): Promise<RunResult> {
  const failed: JobFailure[] = [];
  let completed = 0;

  for (let index = 0; index < jobs.length; index++) {
    if (signal.aborted) return { completed, failed, cancelled: true };
    const job = jobs[index];
    report.onJobStart(job, index);
    try {
      await run(job, signal, (fraction) => report.onJobProgress(job, fraction));
    } catch (err) {
      if (signal.aborted || isAbortError(err)) return { completed, failed, cancelled: true };
      const failure = { job, message: messageOf(err) };
      failed.push(failure);
      report.onJobDone(job, failure);
      continue;
    }
    // Some downloaders settle quietly when aborted instead of throwing.
    if (signal.aborted) return { completed, failed, cancelled: true };
    completed++;
    report.onJobDone(job, null);
  }
  return { completed, failed, cancelled: false };
}
