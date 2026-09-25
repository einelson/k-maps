import { useMemo } from 'react';
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme as NavigationTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { MapScreen } from '../screens/MapScreen';
import { LayersScreen } from '../screens/LayersScreen';
import { DownloadsScreen } from '../screens/DownloadsScreen';
import { ItemsScreen } from '../screens/ItemsScreen';
import { FeatureDetailScreen } from '../screens/FeatureDetailScreen';
import { ImportExportScreen } from '../screens/ImportExportScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { useTheme } from '../theme';
import { IncomingImportHandler } from './IncomingImportHandler';
import { navigationRef } from './navigationRef';
import { RecordingSync } from './RecordingSync';

export type RootStackParamList = {
  /** `editFeatureId` opens the map with that feature's vertex editor active (§7.3). */
  Map: { editFeatureId?: number } | undefined;
  Layers: undefined;
  Downloads: undefined;
  Items: undefined;
  FeatureDetail: { featureId: number };
  ImportExport: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { isDark, colors } = useTheme();

  // Headers, the stack's backdrop and transitions pick their colours from here.
  const navigationTheme = useMemo<NavigationTheme>(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.primaryText,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
      },
    };
  }, [isDark, colors]);

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <Stack.Navigator
        initialRouteName="Map"
        // Status-bar icons follow the header. The map screen has none — the bar floats over the
        // (always light) map tiles — so it keeps dark icons in both themes.
        screenOptions={{ statusBarStyle: isDark ? 'light' : 'dark' }}
      >
        <Stack.Screen
          name="Map"
          component={MapScreen}
          options={{ headerShown: false, statusBarStyle: 'dark' }}
        />
        <Stack.Screen name="Layers" component={LayersScreen} options={{ title: 'Layers' }} />
        <Stack.Screen name="Downloads" component={DownloadsScreen} options={{ title: 'Downloads' }} />
        <Stack.Screen name="Items" component={ItemsScreen} options={{ title: 'My Content' }} />
        <Stack.Screen
          name="FeatureDetail"
          component={FeatureDetailScreen}
          options={{ title: 'Details' }}
        />
        <Stack.Screen
          name="ImportExport"
          component={ImportExportScreen}
          options={{ title: 'Import / Export' }}
        />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      </Stack.Navigator>
      <IncomingImportHandler />
      <RecordingSync />
    </NavigationContainer>
  );
}
