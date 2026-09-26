import { create } from 'zustand';

export interface RunFailure {
  label: string;
  message: string;
}

/**
 * The download that is running (or just finished) from Downloads -> Pick an area. It lives here rather than
 * in the screen so it keeps going — and keeps showing its progress — when you leave the screen and come back.
 * Not saved between launches: a download doesn't survive the app closing.
 */
interface DownloadRunState {
  status: 'idle' | 'running' | 'finished';
  /** Jobs in this run (a job is one layer of one area). */
  total: number;
  done: number;
  /** Jobs left out because that data was already on the device. */
  skipped: number;
  currentLabel: string | null;
  /** 0..1 of the job in progress. */
  currentFraction: number;
  failures: RunFailure[];
  cancelled: boolean;

  begin: (total: number, skipped: number) => void;
  start: (label: string) => void;
  progress: (fraction: number) => void;
  jobDone: (failure: RunFailure | null) => void;
  finish: (cancelled: boolean) => void;
  dismiss: () => void;
}

const IDLE = {
  status: 'idle' as const,
  total: 0,
  done: 0,
  skipped: 0,
  currentLabel: null,
  currentFraction: 0,
  failures: [] as RunFailure[],
  cancelled: false,
};

export const useDownloadRunStore = create<DownloadRunState>((set) => ({
  ...IDLE,
  begin: (total, skipped) => set({ ...IDLE, status: 'running', total, skipped }),
  start: (label) => set({ currentLabel: label, currentFraction: 0 }),
  progress: (fraction) => set({ currentFraction: Math.max(0, Math.min(1, fraction)) }),
  jobDone: (failure) =>
    set((s) => ({ done: s.done + 1, failures: failure ? [...s.failures, failure] : s.failures, currentFraction: 1 })),
  finish: (cancelled) => set({ status: 'finished', cancelled, currentLabel: null, currentFraction: 0 }),
  dismiss: () => set({ ...IDLE }),
}));
