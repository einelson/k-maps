import { useEffect } from 'react';
import { AppState } from 'react-native';

import { WILDFIRE_REFRESH_MS } from '../packs/wildfire';
import { useWildfireStore } from '../state/useWildfireStore';

/**
 * While the wildfire layer is on: show the on-device copy right away (so it works with no signal),
 * then refresh from NIFC now, every 5 minutes, and whenever the app returns to the foreground.
 * `refresh` skips itself when the data is still current, so overlapping callers cost nothing.
 */
export function useWildfireRefresh(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const { loadCached, refresh } = useWildfireStore.getState();
    void loadCached().then(() => refresh());
    const timer = setInterval(() => void useWildfireStore.getState().refresh(), WILDFIRE_REFRESH_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void useWildfireStore.getState().refresh();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [enabled]);
}
