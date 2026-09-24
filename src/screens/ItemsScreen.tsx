import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';

import { listFeatures } from '../data/featuresRepo';
import type { Feature } from '../data/types';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useFiltersStore } from '../state/useFiltersStore';

function featureSubtitle(feature: Feature): string {
  if (feature.type === 'line' && feature.length_m != null) {
    return `Line · ${(feature.length_m / 1000).toFixed(2)} km`;
  }
  if (feature.type === 'polygon' && feature.area_m2 != null) {
    return `Area · ${(feature.area_m2 / 4046.86).toFixed(2)} ac`;
  }
  return 'Point';
}

export function ItemsScreen() {
  const db = useSQLiteContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const filters = useFiltersStore((s) => s.filters);
  const setFilters = useFiltersStore((s) => s.setFilters);
  const [items, setItems] = useState<Feature[]>([]);

  const reload = useCallback(async () => {
    const rows = await listFeatures(db, {
      folderIds: filters.folderIds,
      types: filters.types,
      colors: filters.colors,
      text: filters.text,
    });
    setItems(rows);
  }, [db, filters]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search name or notes…"
        value={filters.text ?? ''}
        onChangeText={(text) => setFilters({ ...filters, text: text || undefined })}
      />

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={<Text style={styles.empty}>No items yet. Drop a pin on the map.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => navigation.navigate('FeatureDetail', { featureId: item.id })}
          >
            <View style={[styles.colorDot, { backgroundColor: item.color ?? '#999' }]} />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{item.name || 'Untitled'}</Text>
              <Text style={styles.rowSubtitle}>{featureSubtitle(item)}</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white' },
  search: {
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  empty: { textAlign: 'center', color: '#888', marginTop: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#eee',
    gap: 12,
  },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowSubtitle: { fontSize: 13, color: '#666' },
});
