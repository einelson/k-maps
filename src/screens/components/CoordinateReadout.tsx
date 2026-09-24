import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import {
  COORDINATE_FORMAT_LABELS,
  formatCoordinate,
  nextCoordinateFormat,
} from '../../features/coordinates';
import { useSettingsStore } from '../../state/useSettingsStore';
import { Text, useThemedStyles, type ThemeColors } from '../../theme';

/**
 * Map-center coordinates (§7.3 / §8.1). Tap the value to cycle DD → DMS → UTM
 * (the same setting Settings and the feature detail screen use); "Copy" puts
 * the shown text on the clipboard.
 */
export function CoordinateReadout({ lon, lat }: { lon: number; lat: number }) {
  const styles = useThemedStyles(makeStyles);
  const format = useSettingsStore((s) => s.coordinateFormat);
  const setFormat = useSettingsStore((s) => s.setCoordinateFormat);
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    []
  );

  const text = formatCoordinate(lon, lat, format);

  async function handleCopy() {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.readout} onPress={() => setFormat(nextCoordinateFormat(format))}>
        <Text style={styles.format}>{COORDINATE_FORMAT_LABELS[format]}</Text>
        <Text style={styles.value}>{text}</Text>
      </Pressable>
      <Pressable style={styles.copy} onPress={handleCopy} hitSlop={6}>
        <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.overlay,
      borderRadius: 16,
      paddingLeft: 10,
      paddingRight: 4,
      paddingVertical: 4,
      gap: 8,
      elevation: 2,
    },
    readout: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    format: { fontSize: 10, fontWeight: '800', color: c.primaryText },
    value: { fontSize: 12, fontWeight: '600', color: c.text },
    copy: { backgroundColor: c.primary, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
    copyText: { color: c.onPrimary, fontSize: 11, fontWeight: '700' },
  });
