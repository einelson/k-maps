import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import type { CoverageRow } from '../../data/types';
import { formatBytes } from '../../downloads/formatBytes';
import { installRegionPack } from '../../downloads/regionPackInstaller';
import { regionPackStatus, type RegionPackStatus } from '../../downloads/regionPackStatus';
import type { ManifestState } from '../../downloads/useRegionManifest';
import { isAbortError } from '../../packs/http';
import type { RegionEntry, RegionPackFile } from '../../packs/regionPacks';
import { regionPackKey, useRegionPackStore } from '../../state/useRegionPackStore';
import { Text, useThemedStyles, type ThemeColors } from '../../theme';

interface Props {
  /** The published pack list, fetched once by the Downloads screen and shared with the other sections. */
  manifest: ManifestState;
  onRetry: () => void;
  /** The coverage table, as loaded by the Downloads screen. */
  coverage: CoverageRow[];
  /** Display names for layers (`land` -> "Public land + private shading"). */
  labels: Record<string, string>;
  /** Called after any install (or cancel) so the screen reloads coverage and the map re-reads its cells. */
  onChanged: () => void | Promise<void>;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Downloads -> "Region packs": whole-region overlay data (public land, forest roads, USFS trails) in one
 * download per layer, from the packs published by tools/build_region_pack.mjs. Far quicker than fetching a
 * region cell by cell from the public services, and it works for regions too large to bundle in the app.
 */
export function RegionPacksSection({ manifest: state, onRetry, coverage, labels, onChanged }: Props) {
  const appDb = useSQLiteContext();
  const styles = useThemedStyles(makeStyles);
  const installedVersions = useRegionPackStore((s) => s.installed);
  const markInstalled = useRegionPackStore((s) => s.markInstalled);

  const [installing, setInstalling] = useState<{ key: string; fraction: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Leaving the screen cancels a running install.
  useEffect(() => () => abortRef.current?.abort(), []);

  const statuses = useMemo(() => {
    const map = new Map<string, RegionPackStatus>();
    if (state.status !== 'ready') return map;
    for (const region of state.manifest.regions) {
      for (const pack of region.packs) {
        map.set(
          regionPackKey(region.id, pack.layer),
          regionPackStatus(region, pack, coverage, installedVersions[regionPackKey(region.id, pack.layer)])
        );
      }
    }
    return map;
  }, [state, coverage, installedVersions]);

  const install = useCallback(
    async (region: RegionEntry, packs: RegionPackFile[]) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setErrors([]);
      const failures: string[] = [];
      for (const pack of packs) {
        if (controller.signal.aborted) break;
        const key = regionPackKey(region.id, pack.layer);
        setInstalling({ key, fraction: 0 });
        try {
          await installRegionPack({
            appDb,
            region,
            pack,
            signal: controller.signal,
            onProgress: (fraction) => setInstalling({ key, fraction }),
          });
          markInstalled(region.id, pack.layer, pack.version);
        } catch (err) {
          if (!isAbortError(err)) failures.push(`${region.name} ${labels[pack.layer] ?? pack.layer}: ${errorMessage(err)}`);
        }
        await onChanged(); // even after a failure or cancel: earlier batches may have installed cells
      }
      abortRef.current = null;
      setInstalling(null);
      setErrors(failures);
    },
    [appDb, labels, markInstalled, onChanged]
  );

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Region packs</Text>
      <Text style={styles.hint}>
        One download per layer for a whole region — much faster than fetching it cell by cell, and it
        keeps working offline. The overlay data below is for anywhere else.
      </Text>

      {state.status === 'loading' && <Text style={styles.note}>Checking for region packs…</Text>}
      {state.status === 'error' && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{state.message}</Text>
          <Pressable onPress={onRetry} hitSlop={8}>
            <Text style={styles.link}>Try again</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'ready' && state.manifest.regions.length === 0 && (
        <Text style={styles.note}>No region packs have been published yet.</Text>
      )}
      {state.status === 'ready' &&
        state.manifest.regions.map((region) => {
          const wanted = region.packs.filter((pack) => statuses.get(regionPackKey(region.id, pack.layer))?.state !== 'installed');
          const wantedBytes = wanted.reduce((sum, pack) => sum + pack.bytes, 0);
          return (
            <View key={region.id} style={styles.region}>
              <View style={styles.regionHeader}>
                <Text style={styles.regionName}>{region.name}</Text>
                {wanted.length > 1 && !installing && (
                  <Pressable onPress={() => install(region, wanted)} hitSlop={8}>
                    <Text style={styles.link}>Download all · {formatBytes(wantedBytes)}</Text>
                  </Pressable>
                )}
              </View>
              {region.packs.map((pack) => {
                const key = regionPackKey(region.id, pack.layer);
                const status = statuses.get(key);
                const active = installing?.key === key;
                return (
                  <View key={key} style={styles.packRow}>
                    <View style={styles.packText}>
                      <Text style={styles.packLabel}>{labels[pack.layer] ?? pack.layer}</Text>
                      <Text style={styles.note}>
                        {status ? statusText(status) : ''}
                        {status?.state === 'installed' ? '' : ` · ${formatBytes(pack.bytes)} download`}
                      </Text>
                    </View>
                    {active ? (
                      <View style={styles.activeColumn}>
                        <Text style={styles.percent}>{Math.round((installing?.fraction ?? 0) * 100)}%</Text>
                        <Pressable onPress={() => abortRef.current?.abort()} hitSlop={8}>
                          <Text style={styles.cancel}>Cancel</Text>
                        </Pressable>
                      </View>
                    ) : status?.state === 'installed' ? (
                      <Text style={styles.done}>Installed ✓</Text>
                    ) : (
                      <Pressable
                        style={[styles.button, installing !== null && styles.buttonDisabled]}
                        disabled={installing !== null}
                        onPress={() => install(region, [pack])}
                      >
                        <Text style={styles.buttonText}>{buttonLabel(status)}</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })}

      {errors.map((message) => (
        <Text key={message} style={styles.errorText}>
          {message}
        </Text>
      ))}
    </View>
  );
}

function statusText({ state, covered, total }: RegionPackStatus): string {
  switch (state) {
    case 'none':
      return 'Not on this device';
    case 'partial':
      return `${covered} of ${total} cells on this device`;
    case 'installed':
      return `All ${total} cells on this device`;
    case 'update':
      return 'A newer version is available';
  }
}

function buttonLabel(status: RegionPackStatus | undefined): string {
  if (status?.state === 'update') return 'Update';
  if (status?.state === 'partial') return 'Complete';
  return 'Download';
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    section: { gap: 8 },
    sectionTitle: { fontWeight: '700', marginTop: 8 },
    hint: { color: c.textMuted, fontSize: 13 },
    note: { color: c.textMuted, fontSize: 12, marginTop: 2 },
    region: { gap: 6 },
    regionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    regionName: { fontWeight: '600', fontSize: 15 },
    packRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 10,
      borderRadius: 10,
      backgroundColor: c.field,
    },
    packText: { flex: 1 },
    packLabel: { fontWeight: '600', fontSize: 14 },
    button: { backgroundColor: c.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
    buttonDisabled: { backgroundColor: c.disabled },
    buttonText: { color: c.onPrimary, fontWeight: '700' },
    done: { color: c.textMuted, fontWeight: '600' },
    activeColumn: { alignItems: 'flex-end', gap: 2 },
    percent: { fontWeight: '700' },
    cancel: { color: c.danger, fontWeight: '600', fontSize: 12 },
    link: { color: c.primary, fontWeight: '600' },
    errorBox: { gap: 4 },
    errorText: { color: c.danger, fontSize: 12 },
  });
