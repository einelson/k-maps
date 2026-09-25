import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './RootNavigator';

/** For code that runs outside a screen (e.g. after a file is opened from another app) and needs to navigate. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
