import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MapScreenMap } from '../map/MapView';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useDrawStore } from '../state/useDrawStore';
import type { DrawTool } from '../state/types';

const DRAW_TOOLS: { id: DrawTool; label: string }[] = [
  { id: 'point', label: 'Point' },
  { id: 'line', label: 'Line' },
  { id: 'polygon', label: 'Area' },
  { id: 'measure', label: 'Measure' },
];

export function MapScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const activeTool = useDrawStore((s) => s.activeTool);
  const setActiveTool = useDrawStore((s) => s.setActiveTool);
  const addVertex = useDrawStore((s) => s.addVertex);

  return (
    <View style={styles.container}>
      <MapScreenMap
        onMapPress={(lngLat) => {
          if (activeTool !== 'none') addVertex(lngLat);
        }}
      />

      <View style={styles.topBar}>
        <Pressable style={styles.chip} onPress={() => navigation.navigate('Layers')}>
          <Text style={styles.chipText}>Layers</Text>
        </Pressable>
        <Pressable style={styles.chip} onPress={() => navigation.navigate('Items')}>
          <Text style={styles.chipText}>Items</Text>
        </Pressable>
        <Pressable style={styles.chip} onPress={() => navigation.navigate('Downloads')}>
          <Text style={styles.chipText}>Downloads</Text>
        </Pressable>
      </View>

      <View style={styles.topRightBar}>
        <Pressable style={styles.iconChip} onPress={() => navigation.navigate('ImportExport')}>
          <Text style={styles.chipText}>⇅</Text>
        </Pressable>
        <Pressable style={styles.iconChip} onPress={() => navigation.navigate('Settings')}>
          <Text style={styles.chipText}>⚙</Text>
        </Pressable>
      </View>

      <View style={styles.drawToolbar}>
        {DRAW_TOOLS.map((tool) => (
          <Pressable
            key={tool.id}
            style={[styles.toolButton, activeTool === tool.id && styles.toolButtonActive]}
            onPress={() => setActiveTool(activeTool === tool.id ? 'none' : tool.id)}
          >
            <Text style={styles.toolButtonText}>{tool.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 56,
    left: 12,
    right: 12,
    flexDirection: 'row',
    gap: 8,
  },
  topRightBar: {
    position: 'absolute',
    top: 104,
    left: 12,
    flexDirection: 'row',
    gap: 8,
  },
  iconChip: {
    backgroundColor: 'white',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  chip: {
    backgroundColor: 'white',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  chipText: { fontWeight: '600' },
  drawToolbar: {
    position: 'absolute',
    bottom: 32,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'white',
    borderRadius: 24,
    paddingVertical: 10,
    elevation: 2,
  },
  toolButton: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  toolButtonActive: { backgroundColor: '#2f6f4f' },
  toolButtonText: { fontWeight: '600' },
});
