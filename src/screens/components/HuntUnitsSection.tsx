import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { formatBytes } from '../../downloads/formatBytes';
import { huntUnitStatus } from '../../downloads/huntUnitStatus';
import { installHuntUnitPack } from '../../downloads/huntUnitInstaller';
import type { ManifestState } from '../../downloads/useRegionManifest';
import { deleteHuntUnits, huntUnitsExist } from '../../huntUnits/storage';
import { isAbortError } from '../../packs/http';
import type { HuntUnitPackEntry } from '../../packs/regionPacks';
import { HUNT_UNIT_DISCLAIMER_TITLE, huntUnitDataSummary } from '../../map/huntUnitsStyle';
import { acceptanceFor, staleSummary, unacceptedStale, type StaleNotice } from '../../map/huntUnitStaleness';
import { resolveActiveSet, useHuntUnitStore } from '../../state/useHuntUnitStore';
import { Text, useThemedStyles, type ThemeColors } from '../../theme';
import { HuntUnitDisclaimerModal } from './HuntUnitDisclaimerModal';

interface Props {
  /** The published pack list, fetched once by the Downloads screen and shared with the other sections. */
  manifest: ManifestState;
  onRetry: () => void;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Downloads -> "Hunting units": each state's hunt units / management zones / hunt districts from its wildlife agency,
 * one small download per state. Downloaded states are stored on the device and drawn from there, so they work with
 * no connection. States that publish separate species layers (Wyoming, Montana ...) get a picker for which one the
 * map shows.
 */
export function HuntUnitsSection({ manifest, onRetry }: Props) {
  const styles = useThemedStyles(makeStyles);
  const installed = useHuntUnitStore((s) => s.installed);
  const activeSets = useHuntUnitStore((s) => s.activeSets);
  const markInstalled = useHuntUnitStore((s) => s.markInstalled);
  const markRemoved = useHuntUnitStore((s) => s.markRemoved);
  const setActiveSet = useHuntUnitStore((s) => s.setActiveSet);
  const disclaimerAccepted = useHuntUnitStore((s) => s.disclaimerAccepted);
  const acceptDisclaimer = useHuntUnitStore((s) => s.acceptDisclaimer);
  const staleAccepted = useHuntUnitStore((s) => s.staleAccepted);
  const acceptStale = useHuntUnitStore((s) => s.acceptStale);

  const [installing, setInstalling] = useState<{ state: string; fraction: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  /** The list of states is long (30 cards), so the section starts folded away; the heading opens it. */
  const [expanded, setExpanded] = useState(false);
  /** Downloads waiting for the hunter to acknowledge the disclaimer (once) and/or the old-data notices for these packs. */
  const [awaiting, setAwaiting] = useState<{ packs: HuntUnitPackEntry[]; general: boolean; notices: StaleNotice[] } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Leaving the screen cancels a running download.
  useEffect(() => () => abortRef.current?.abort(), []);

  const packs = useMemo(
    () => (manifest.status === 'ready' ? [...manifest.manifest.huntUnits].sort((a, b) => a.name.localeCompare(b.name)) : []),
    [manifest]
  );

  const statusOf = useCallback(
    (pack: HuntUnitPackEntry) => huntUnitStatus(pack, installed[pack.state], !!installed[pack.state] && huntUnitsExist(pack.state)),
    [installed]
  );

  /** States already on the device (or with an update waiting) come first, so what you've added is at the top; each group is A-Z. */
  const ordered = useMemo(() => {
    const rank = (pack: HuntUnitPackEntry) => (statusOf(pack) === 'none' ? 1 : 0);
    return [...packs].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [packs, statusOf]);

  const install = useCallback(
    async (toInstall: HuntUnitPackEntry[]) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setErrors([]);
      const failures: string[] = [];
      for (const pack of toInstall) {
        if (controller.signal.aborted) break;
        setInstalling({ state: pack.state, fraction: 0 });
        try {
          const bytes = await installHuntUnitPack({
            pack,
            signal: controller.signal,
            onProgress: (fraction) => setInstalling({ state: pack.state, fraction }),
          });
          markInstalled(pack, bytes); // the map picks it up from the store straight away
        } catch (err) {
          if (!isAbortError(err)) failures.push(`${pack.name}: ${errorMessage(err)}`);
        }
      }
      abortRef.current = null;
      setInstalling(null);
      setErrors(failures);
    },
    [markInstalled]
  );

  /** Starts downloads, first making sure the hunter has accepted the disclaimer and any old-data notices. */
  function startInstall(toInstall: HuntUnitPackEntry[]) {
    const notices = unacceptedStale(toInstall, staleAccepted);
    if (disclaimerAccepted && notices.length === 0) install(toInstall);
    else setAwaiting({ packs: toInstall, general: !disclaimerAccepted, notices });
  }

  function confirmRemove(pack: HuntUnitPackEntry) {
    Alert.alert(`Remove ${pack.name} hunting units?`, 'They are removed from this device. You can download them again later.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          try {
            deleteHuntUnits(pack.state);
          } catch (err) {
            setErrors([`${pack.name}: ${errorMessage(err)}`]);
          }
          markRemoved(pack.state);
        },
      },
    ]);
  }

  const pending = packs.filter((pack) => statusOf(pack) !== 'installed');
  const pendingBytes = pending.reduce((sum, pack) => sum + pack.bytes, 0);
  /** Shown beside the title so a folded section still says where things stand — and that a download is running. */
  const onDevice = packs.filter((pack) => statusOf(pack) !== 'none').length;
  const installingName = installing ? packs.find((pack) => pack.state === installing.state)?.name : undefined;
  const summary = installing
    ? `Downloading${installingName ? ` ${installingName}` : ''} ${Math.round(installing.fraction * 100)}%`
    : packs.length > 0
      ? `${onDevice} of ${packs.length} on device`
      : null;

  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel="Hunting units"
          style={styles.header}
          onPress={() => setExpanded((open) => !open)}
        >
          <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
          <Text style={styles.sectionTitle}>Hunting units</Text>
          {summary && <Text style={styles.summary}>{summary}</Text>}
        </Pressable>
        {expanded && pending.length > 1 && !installing && (
          <Pressable onPress={() => startInstall(pending)} hitSlop={8}>
            <Text style={styles.link}>Download all · {formatBytes(pendingBytes)}</Text>
          </Pressable>
        )}
      </View>
      {expanded && (
        <>
          <Text style={styles.hint}>
            Hunt units, management zones and hunt districts from each state&apos;s wildlife agency. Downloaded states are stored
            on this device and work offline; turn the layer on in Layers.
          </Text>
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>{HUNT_UNIT_DISCLAIMER_TITLE}</Text>
            <Text style={styles.noticeText}>
              Boundaries are for reference only and may be out of date or inaccurate. Confirm them in the current hunting
              regulations for your state, and follow local laws, before you hunt.
            </Text>
          </View>

          {manifest.status === 'loading' && <Text style={styles.note}>Checking for available states…</Text>}
          {manifest.status === 'error' && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{manifest.message}</Text>
              <Pressable onPress={onRetry} hitSlop={8}>
                <Text style={styles.link}>Try again</Text>
              </Pressable>
            </View>
          )}
          {manifest.status === 'ready' && packs.length === 0 && <Text style={styles.note}>No states have been published yet.</Text>}

          {ordered.map((pack) => {
            const status = statusOf(pack);
            const record = installed[pack.state];
            const active = installing?.state === pack.state;
            const shownSet = record ? resolveActiveSet(record, activeSets[pack.state]) : null;
            return (
              <View key={pack.state} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={styles.text}>
                    <Text style={styles.name}>{pack.name}</Text>
                    <Text style={styles.note}>
                      {pack.unitCount} units · {formatBytes(pack.bytes)}
                      {status === 'none' ? '' : status === 'update' ? ' · newer version available' : ` · on this device`}
                    </Text>
                    <Text style={styles.note}>{huntUnitDataSummary(pack)}</Text>
                    {staleSummary(pack) && <Text style={styles.staleNote}>{staleSummary(pack)}</Text>}
                  </View>
                  {active ? (
                    <View style={styles.activeColumn}>
                      <Text style={styles.percent}>{Math.round((installing?.fraction ?? 0) * 100)}%</Text>
                      <Pressable onPress={() => abortRef.current?.abort()} hitSlop={8}>
                        <Text style={styles.cancel}>Cancel</Text>
                      </Pressable>
                    </View>
                  ) : status === 'installed' ? (
                    <View style={styles.activeColumn}>
                      <Text style={styles.done}>Installed ✓</Text>
                      <Pressable onPress={() => confirmRemove(pack)} hitSlop={8}>
                        <Text style={styles.cancel}>Remove</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      style={[styles.button, installing !== null && styles.buttonDisabled]}
                      disabled={installing !== null}
                      onPress={() => startInstall([pack])}
                    >
                      <Text style={styles.buttonText}>{status === 'update' ? 'Update' : 'Download'}</Text>
                    </Pressable>
                  )}
                </View>
                {record && record.sets.length > 1 && (
                  <View style={styles.chips}>
                    {record.sets.map((set) => (
                      <Pressable
                        key={set.id}
                        style={[styles.chip, shownSet === set.id && styles.chipActive]}
                        onPress={() => setActiveSet(pack.state, set.id)}
                        accessibilityLabel={`Show ${set.label}`}
                      >
                        <Text style={shownSet === set.id ? styles.chipTextActive : styles.chipText}>{set.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </>
      )}

      {errors.map((message) => (
        <Text key={message} style={styles.errorText}>
          {message}
        </Text>
      ))}

      <HuntUnitDisclaimerModal
        visible={awaiting !== null}
        showGeneral={awaiting?.general ?? false}
        notices={awaiting?.notices ?? []}
        onAccept={() => {
          const waiting = awaiting;
          setAwaiting(null);
          if (!waiting) return;
          if (waiting.general) acceptDisclaimer();
          acceptStale(acceptanceFor(waiting.packs));
          install(waiting.packs);
        }}
        onDecline={() => setAwaiting(null)}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    section: { gap: 8 },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8 },
    header: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
    chevron: { width: 14, fontSize: 12, color: c.textMuted },
    sectionTitle: { fontWeight: '700' },
    summary: { flexShrink: 1, fontSize: 12, color: c.textMuted },
    hint: { color: c.textMuted, fontSize: 13 },
    notice: { padding: 10, borderRadius: 10, borderWidth: 1, borderColor: c.borderStrong, gap: 2 },
    noticeTitle: { fontWeight: '700', fontSize: 13 },
    noticeText: { fontSize: 12, color: c.textMuted },
    note: { color: c.textMuted, fontSize: 12, marginTop: 2 },
    staleNote: { color: c.danger, fontSize: 12, fontWeight: '600', marginTop: 2 },
    card: { padding: 10, borderRadius: 10, backgroundColor: c.field, gap: 8 },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    text: { flex: 1 },
    name: { fontWeight: '600', fontSize: 14 },
    button: { backgroundColor: c.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
    buttonDisabled: { backgroundColor: c.disabled },
    buttonText: { color: c.onPrimary, fontWeight: '700' },
    done: { color: c.textMuted, fontWeight: '600' },
    activeColumn: { alignItems: 'flex-end', gap: 2 },
    percent: { fontWeight: '700' },
    cancel: { color: c.danger, fontWeight: '600', fontSize: 12 },
    link: { color: c.primary, fontWeight: '600' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: c.chip },
    chipActive: { backgroundColor: c.primary },
    chipText: { fontSize: 12, fontWeight: '600' },
    chipTextActive: { fontSize: 12, fontWeight: '600', color: c.onPrimary },
    errorBox: { gap: 4 },
    errorText: { color: c.danger, fontSize: 12 },
  });
