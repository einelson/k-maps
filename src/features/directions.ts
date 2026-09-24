import { Linking, Platform } from 'react-native';

/**
 * Hands off to the phone's own maps app rather than the app trying to do
 * routing itself. `geo:` on Android lets the OS pick the user's default (or
 * show a chooser) among Google Maps/Waze/etc; iOS has no such system concept,
 * so it opens Apple Maps directly.
 */
export async function openDirections(
  lat: number,
  lon: number,
  label?: string | null
): Promise<void> {
  const encodedLabel = encodeURIComponent(label ?? '');
  const url =
    Platform.OS === 'ios'
      ? `maps://?daddr=${lat},${lon}${label ? `&q=${encodedLabel}` : ''}`
      : `geo:${lat},${lon}?q=${lat},${lon}${label ? `(${encodedLabel})` : ''}`;
  const fallback = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;

  // Not `canOpenURL` first: on Android 11+ it returns false for `geo:` unless the manifest
  // declares a matching <queries> intent, which would always send people to the web fallback.
  try {
    await Linking.openURL(url);
  } catch {
    await Linking.openURL(fallback);
  }
}
