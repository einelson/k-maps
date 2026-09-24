import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, type DimensionValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemedStyles, type ThemeColors } from '../../theme';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Cap on the sheet's height; its contents scroll or clip past it. */
  maxHeight?: DimensionValue;
  children: ReactNode;
}

const SHEET_PADDING = 16;

/**
 * A sheet that slides up from the bottom over a dimmed backdrop; tapping the backdrop closes it.
 * The app draws edge-to-edge, so the sheet pads its bottom by the navigation-bar inset —
 * otherwise its last row (usually Cancel) sits under the system buttons.
 */
export function BottomSheet({ visible, onClose, maxHeight = '70%', children }: BottomSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { maxHeight, paddingBottom: SHEET_PADDING + insets.bottom }]}
          onPress={(e) => e.stopPropagation()}
        >
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: SHEET_PADDING,
    },
  });
