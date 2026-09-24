import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { MapScreen } from '../screens/MapScreen';
import { LayersScreen } from '../screens/LayersScreen';
import { DownloadsScreen } from '../screens/DownloadsScreen';
import { ItemsScreen } from '../screens/ItemsScreen';
import { FeatureDetailScreen } from '../screens/FeatureDetailScreen';
import { ImportExportScreen } from '../screens/ImportExportScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type RootStackParamList = {
  Map: undefined;
  Layers: undefined;
  Downloads: undefined;
  Items: undefined;
  FeatureDetail: { featureId: number };
  ImportExport: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Map">
        <Stack.Screen name="Map" component={MapScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Layers" component={LayersScreen} options={{ title: 'Layers' }} />
        <Stack.Screen name="Downloads" component={DownloadsScreen} options={{ title: 'Downloads' }} />
        <Stack.Screen name="Items" component={ItemsScreen} options={{ title: 'Items' }} />
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
    </NavigationContainer>
  );
}
