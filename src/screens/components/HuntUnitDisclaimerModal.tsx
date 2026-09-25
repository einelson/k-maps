import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { HUNT_UNIT_DISCLAIMER_POINTS, HUNT_UNIT_DISCLAIMER_TITLE, formatDataDate } from '../../map/huntUnitsStyle';
import { ageText, STALE_AFTER_YEARS, type StaleNotice } from '../../map/huntUnitStaleness';
import { Text, useThemedStyles, type ThemeColors } from '../../theme';
import { BottomSheet } from './BottomSheet';

interface Props {
  visible: boolean;
  /** Show the once-only general disclaimer (false once the hunter has accepted it). */
  showGeneral: boolean;
  /** Layers whose source data was last edited 3+ years ago and haven't been accepted yet. */
  notices: StaleNotice[];
  /** "I understand": remembered, so the same thing isn't asked twice. */
  onAccept: () => void;
  /** "Not now" or tapping outside: nothing is enabled / downloaded. */
  onDecline: () => void;
}

/**
 * The acknowledgement the hunter must give before hunting units are used: once for the general disclaimer (boundaries
 * are a reference, not a legal boundary — check the regulations and local laws), and for any layer whose source data
 * is three or more years old. Declining leaves everything as it was.
 */
export function HuntUnitDisclaimerModal({ visible, showGeneral, notices, onAccept, onDecline }: Props) {
  const styles = useThemedStyles(makeStyles);
  const title = showGeneral ? HUNT_UNIT_DISCLAIMER_TITLE : 'Some of this data is old';
  return (
    <BottomSheet visible={visible} onClose={onDecline} maxHeight="85%">
      <Text style={styles.title}>{title}</Text>
      <ScrollView style={styles.body}>
        {showGeneral && (
          <View style={styles.points}>
            {HUNT_UNIT_DISCLAIMER_POINTS.map((point) => (
              <Text key={point} style={styles.point}>
                {point}
              </Text>
            ))}
          </View>
        )}
        {notices.length > 0 && (
          <View style={[styles.stale, showGeneral && styles.staleSpaced]}>
            {showGeneral && <Text style={styles.staleTitle}>Some of this data is old</Text>}
            <Text style={styles.point}>
              The source data for these layers was last edited {STALE_AFTER_YEARS} or more years ago, so the boundaries may no
              longer match the current regulations:
            </Text>
            {notices.map((notice) => (
              <Text key={`${notice.state}:${notice.setId}`} style={styles.notice}>
                {notice.stateName} · {notice.layer}: last edited {formatDataDate(notice.updated)} ({ageText(notice.years)})
              </Text>
            ))}
            <Text style={styles.point}>
              Confirm the current boundaries in the state&apos;s hunting regulations before you rely on them.
            </Text>
          </View>
        )}
      </ScrollView>
      <View style={styles.buttons}>
        <Pressable style={styles.decline} onPress={onDecline}>
          <Text style={styles.declineText}>Not now</Text>
        </Pressable>
        <Pressable style={styles.accept} onPress={onAccept}>
          <Text style={styles.acceptText}>I understand</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    title: { fontSize: 17, fontWeight: '700', marginBottom: 12 },
    body: { flexGrow: 0 },
    points: { gap: 10 },
    point: { fontSize: 14, lineHeight: 20 },
    stale: { gap: 8 },
    staleSpaced: { marginTop: 16, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border },
    staleTitle: { fontSize: 15, fontWeight: '700', color: c.danger },
    notice: { fontSize: 14, fontWeight: '600', lineHeight: 20, paddingLeft: 8 },
    buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 20 },
    decline: { paddingHorizontal: 14, paddingVertical: 10 },
    declineText: { color: c.textMuted, fontWeight: '600' },
    accept: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, backgroundColor: c.primary },
    acceptText: { color: c.onPrimary, fontWeight: '700' },
  });
