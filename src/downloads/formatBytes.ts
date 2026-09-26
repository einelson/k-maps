/** "850 KB", "3.4 MB", "28 MB", "1.4 GB" — for download sizes and storage totals. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(bytes < 10_000_000_000 ? 1 : 0)} GB`;
}

/** "under a minute", "about 12 min", "about 1 h 20 min" — a rough wait, never a promise. */
export function formatWait(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (seconds < 60) return 'under a minute';
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `about ${hours} h` : `about ${hours} h ${rest} min`;
}
