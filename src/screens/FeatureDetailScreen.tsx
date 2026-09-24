import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';

import { deleteFeature } from '../data/featuresRepo';
import type { Feature } from '../data/types';
import { openDirections } from '../features/directions';
import type { RootStackParamList } from '../navigation/RootNavigator';

/** GeoJSON coordinates are [lon, lat]; returns null for non-point geometry (or a Directions button doesn't apply). */
function parsePointLonLat(geometry: string): [number, number] | null {
  try {
    const parsed = JSON.parse(geometry) as { type: string; coordinates: unknown };
    return parsed.type === 'Point' ? (parsed.coordinates as [number, number]) : null;
  } catch {
    return null;
  }
}

/** Decimal degrees for now (§7.3 wants DMS/UTM too). */
function formatCoordinates(geometry: string): string {
  const point = parsePointLonLat(geometry);
  if (point) {
    const [lon, lat] = point;
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
  try {
    return (JSON.parse(geometry) as { type: string }).type;
  } catch {
    return 'Unknown geometry';
  }
}

export function FeatureDetailScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'FeatureDetail'>>();
  const { featureId } = route.params;

  const [feature, setFeature] = useState<Feature | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    const row = await db.getFirstAsync<Feature>('SELECT * FROM features WHERE id = ?', featureId);
    setFeature(row);
    setName(row?.name ?? '');
    setNotes(row?.notes ?? '');
  }, [db, featureId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function save() {
    await db.runAsync(
      'UPDATE features SET name = ?, notes = ?, updated_at = ? WHERE id = ?',
      name || null,
      notes || null,
      Date.now(),
      featureId
    );
    navigation.goBack();
  }

  function confirmDelete() {
    Alert.alert('Delete item?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteFeature(db, featureId);
          navigation.goBack();
        },
      },
    ]);
  }

  if (!feature) {
    return (
      <View style={styles.container}>
        <Text>Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Untitled" />

      <Text style={styles.label}>Notes</Text>
      <TextInput
        style={[styles.input, styles.notesInput]}
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      <Text style={styles.label}>Coordinates</Text>
      <Text style={styles.readonlyValue}>{formatCoordinates(feature.geometry)}</Text>

      <Text style={styles.label}>Type</Text>
      <Text style={styles.readonlyValue}>{feature.type}</Text>

      {feature.type === 'point' &&
        (() => {
          const point = parsePointLonLat(feature.geometry);
          if (!point) return null;
          const [lon, lat] = point;
          return (
            <Pressable
              style={styles.directionsButton}
              onPress={() => openDirections(lat, lon, feature.name)}
            >
              <Text style={styles.directionsButtonText}>Get Directions</Text>
            </Pressable>
          );
        })()}

      <Pressable style={styles.saveButton} onPress={save}>
        <Text style={styles.saveButtonText}>Save</Text>
      </Pressable>

      <Pressable style={styles.deleteButton} onPress={confirmDelete}>
        <Text style={styles.deleteButtonText}>Delete</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white' },
  content: { padding: 16, gap: 4 },
  label: { fontSize: 12, color: '#888', marginTop: 12, textTransform: 'uppercase' },
  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
    paddingVertical: 8,
    fontSize: 16,
  },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },
  readonlyValue: { fontSize: 16, paddingVertical: 8 },
  saveButton: {
    marginTop: 24,
    backgroundColor: '#2f6f4f',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonText: { color: 'white', fontWeight: '700' },
  directionsButton: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#2f6f4f',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  directionsButtonText: { color: '#2f6f4f', fontWeight: '700' },
  deleteButton: { marginTop: 12, paddingVertical: 12, alignItems: 'center' },
  deleteButtonText: { color: '#c0392b', fontWeight: '600' },
});
