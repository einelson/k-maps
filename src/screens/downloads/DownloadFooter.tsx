import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DownloadEstimate } from '../../downloads/downloadPlan';
import { formatBytes, formatWait } from '../../downloads/formatBytes';
import { cancelDownload } from '../../downloads/startDownload';
import { useDownloadRunStore } from '../../state/useDownloadRunStore';
import { Text, useThemedStyles, type ThemeColors } from '../../theme';

/** How often finished squares are re-read from the coverage table while downloading, so the map turns them blue as it goes. */
const COVERAGE_REFRESH_MS = 1500;
/** Warn in red past this. */
const HUGE_BYTES = 3_000_000_000;
/** Failure lines shown before "…and N more". */
const MAX_FAILURES_SHOWN = 20;

interface Props {
  /** Why the header's Download button can't be pressed right now, or null when it can. */
  blocked: string | null;
  /** Things still to download / already on the phone, for the current picks. */
  jobCount: number;
  skipped: number;
  estimate: DownloadEstimate;
  hasSelection: boolean;
  /** Runs the download again for whatever is still missing. */
  onRetry: () => void;
  reloadCoverage: () => Promise<void>;
}

/**
 * The bar under "Pick an area" that is always on screen: the total (the Download button is in the header, to leave
 * the picklist more room), then live progress with Cancel while it runs, then the result. It subscribes to the download's progress itself so a tile
 * finishing re-renders this bar, not the map above it.
 */
export function DownloadFooter({
  blocked,
  jobCount,
  skipped,
  estimate,
  hasSelection,
  onRetry,
  reloadCoverage,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const run = useDownloadRunStore();
  const [showFailures, setShowFailures] = useState(false);

  // Re-read the coverage table while a download runs (throttled) and once it ends.
  useEffect(() => {
    if (run.status === 'idle') return;
    const timer = setTimeout(() => void reloadCoverage(), run.status === 'finished' ? 0 : COVERAGE_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [run.status, run.done, reloadCoverage]);

  const saved = run.done - run.failures.length;
  const overall = run.total === 0 ? 0 : (run.done + run.currentFraction) / run.total;

  return (
    <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
      {run.status === 'running' ? (
        <>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.title}>
                Downloading {Math.min(run.done + 1, run.total)} of {run.total}
              </Text>
              <Text style={styles.note} numberOfLines={1}>
                {run.currentLabel ?? 'Starting…'}
              </Text>
            </View>
            <Pressable style={styles.cancelButton} onPress={cancelDownload} accessibilityRole="button">
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
          <View style={styles.track}>
            <View style={[styles.trackFill, { width: `${Math.round(overall * 100)}%` }]} />
          </View>
          <Text style={styles.note}>You can leave this screen — it keeps going while K-Maps is open.</Text>
        </>
      ) : run.status === 'finished' ? (
        <>
          <Text style={styles.title}>
            {run.cancelled
              ? `Stopped — ${saved} of ${run.total} saved`
              : run.failures.length > 0
                ? `${saved} saved, ${run.failures.length} failed`
                : run.total === 0
                  ? 'Nothing to download'
                  : `Done — ${saved} saved to this phone`}
          </Text>
          {run.cancelled && <Text style={styles.note}>Finished squares are kept.</Text>}
          {run.failures.length > 0 && (
            <>
              <Pressable onPress={() => setShowFailures((v) => !v)} hitSlop={8}>
                <Text style={styles.link}>{showFailures ? 'Hide details' : 'Show what failed'}</Text>
              </Pressable>
              {showFailures &&
                run.failures.slice(0, MAX_FAILURES_SHOWN).map((failure, i) => (
                  <Text key={`${failure.label}-${i}`} style={styles.failure}>
                    {failure.label}: {failure.message}
                  </Text>
                ))}
              {showFailures && run.failures.length > MAX_FAILURES_SHOWN && (
                <Text style={styles.failure}>…and {run.failures.length - MAX_FAILURES_SHOWN} more</Text>
              )}
            </>
          )}
          <View style={styles.buttons}>
            {run.failures.length > 0 && !blocked && (
              <Pressable style={[styles.primaryButton, styles.grow]} onPress={onRetry} accessibilityRole="button">
                <Text style={styles.primaryText}>Retry what&rsquo;s missing</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.secondaryButton, styles.grow]}
              onPress={() => {
                useDownloadRunStore.getState().dismiss();
                setShowFailures(false);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>OK</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={[styles.title, estimate.bytes >= HUGE_BYTES && styles.titleWarn]}>
            {!hasSelection || jobCount === 0
              ? 'Nothing to download yet'
              : `About ${formatBytes(estimate.bytes)}${estimate.packSeconds > 0 ? ` · ${formatWait(estimate.packSeconds)} for land & trail data` : ''}`}
          </Text>
          {skipped > 0 && jobCount > 0 && (
            <Text style={styles.note}>
              {skipped} already on this phone {skipped === 1 ? 'is' : 'are'} skipped.
            </Text>
          )}
          {estimate.bytes >= HUGE_BYTES && !blocked && (
            <Text style={styles.warning}>That is a lot of storage. Try fewer squares or a lower detail level.</Text>
          )}
          {blocked && <Text style={styles.note}>{blocked}</Text>}
        </>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    footer: {
      paddingHorizontal: 16,
      paddingTop: 12,
      gap: 6,
      backgroundColor: c.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowText: { flex: 1 },
    title: { fontSize: 15, fontWeight: '700' },
    titleWarn: { color: c.danger },
    note: { fontSize: 12, color: c.textMuted },
    warning: { fontSize: 13, color: c.danger },
    link: { color: c.primaryText, fontWeight: '600' },
    buttons: { flexDirection: 'row', gap: 8 },
    grow: { flex: 1 },
    failure: { fontSize: 12, color: c.danger },
    track: { height: 6, borderRadius: 3, backgroundColor: c.chip, overflow: 'hidden' },
    trackFill: { height: 6, backgroundColor: c.primary },
    primaryButton: { backgroundColor: c.primary, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
    primaryText: { color: c.onPrimary, fontWeight: '700', fontSize: 15 },
    secondaryButton: {
      borderRadius: 10,
      paddingVertical: 13,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.borderStrong,
    },
    secondaryText: { fontWeight: '700', fontSize: 15 },
    cancelButton: { borderRadius: 8, borderWidth: 1, borderColor: c.danger, paddingHorizontal: 16, paddingVertical: 9 },
    cancelText: { color: c.danger, fontWeight: '700' },
  });
