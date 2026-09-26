import { Platform } from 'react-native';

/**
 * Must be index.ts's very first import. The car library swaps the global timers for ones that keep firing while
 * the phone is locked or backgrounded but the car is showing K-Maps (the stock ones stall, which would freeze the
 * recording clock on the car screen). It has to happen before anything else keeps a reference to the originals.
 *
 * Android only for now: the library isn't linked into iOS builds (react-native.config.js) until CarPlay is set up.
 */
if (Platform.OS === 'android') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@iternio/react-native-auto-play/installTimers');
}
