/** Shared by the recorder (starts the task) and the task itself (receives the fixes). */
export const TRACK_TASK_NAME = 'kmaps-track-recording';

/**
 * Fixes worse than this are dropped. A cold GPS start reports a wide-open guess first (often hundreds of
 * metres off), which would otherwise draw a spike at the start of every track.
 */
export const MAX_ACCURACY_M = 50;
