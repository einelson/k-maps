import { Platform } from 'react-native';

/**
 * Starts the car integration where it exists (Android Auto today; see installCarTimers.ts for why not iOS).
 * The car module is loaded lazily so a platform without the native library never touches it, and a failure to
 * set it up is logged rather than taking the whole app down over a feature most people aren't using.
 */
export function registerCar(): void {
  if (Platform.OS !== 'android') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./carApp') as typeof import('./carApp')).registerCarApp();
  } catch (err) {
    console.warn('Could not set up the car screen', err);
  }
}
