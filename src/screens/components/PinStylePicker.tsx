import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { PIN_STYLES, type PinStyleId } from '../../features/pinStyles';
import { Text, useThemedStyles, type ThemeColors } from '../../theme';
import { PinPreview } from './PinPreview';

interface PinStylePickerProps {
  value: PinStyleId;
  /** Colour the previews are drawn in, so you see the pin as it will look on the map. */
  color: string;
  onChange: (style: PinStyleId) => void;
}

/** Scrollable row of pin styles, each previewed as a small pin. */
export function PinStylePicker({ value, color, onChange }: PinStylePickerProps) {
  const styles = useThemedStyles(makeStyles);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {PIN_STYLES.map((style) => {
        const selected = style.id === value;
        return (
          <Pressable
            key={style.id}
            accessibilityRole="button"
            accessibilityLabel={`${style.label} pin`}
            accessibilityState={{ selected }}
            style={[styles.tile, selected && styles.tileSelected]}
            onPress={() => onChange(style.id)}
          >
            <PinPreview style={style.id} color={color} size={38} />
            <Text style={[styles.label, selected && styles.labelSelected]}>{style.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: { gap: 8, paddingVertical: 6 },
    tile: {
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: 'transparent',
      backgroundColor: c.field,
    },
    tileSelected: { borderColor: c.primaryText, backgroundColor: c.primaryTint },
    label: { fontSize: 11, color: c.textSecondary, fontWeight: '600' },
    labelSelected: { color: c.primaryText },
  });
