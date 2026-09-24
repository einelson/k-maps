import { Image, StyleSheet, View } from 'react-native';

import type { PinStyleId } from '../../features/pinStyles';
import { PIN_IMAGE_HEIGHT, PIN_IMAGE_WIDTH, PIN_MASKS } from '../../map/pinImages';

interface PinPreviewProps {
  style: PinStyleId;
  color: string;
  /** Height in dp; width follows the artwork's aspect ratio. */
  size?: number;
}

/** A pin drawn in React Native (not on the map) — what the style pickers show. */
export function PinPreview({ style, color, size = 40 }: PinPreviewProps) {
  const width = (size * PIN_IMAGE_WIDTH) / PIN_IMAGE_HEIGHT;
  return (
    <View style={{ width, height: size }}>
      <Image source={PIN_MASKS.body} style={[styles.layer, { width, height: size, tintColor: color }]} />
      <Image source={PIN_MASKS[style]} style={[styles.layer, { width, height: size, tintColor: '#ffffff' }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, top: 0 },
});
