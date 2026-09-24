import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

function notYetImplemented(action: string) {
  Alert.alert(action, 'Not implemented yet — planned for Phase 4 (§4 of the roadmap in docs/SPEC.md).');
}

export function ImportExportScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Import</Text>
      <Pressable style={styles.button} onPress={() => notYetImplemented('Import GPX/KML/GeoJSON')}>
        <Text style={styles.buttonText}>Import GPX / KML / GeoJSON…</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Export</Text>
      <Pressable style={styles.button} onPress={() => notYetImplemented('Export by folder')}>
        <Text style={styles.buttonText}>Export by folder…</Text>
      </Pressable>
      <Pressable style={styles.button} onPress={() => notYetImplemented('Export current filter')}>
        <Text style={styles.buttonText}>Export current filter…</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Backup</Text>
      <Pressable style={styles.button} onPress={() => notYetImplemented('Full backup')}>
        <Text style={styles.buttonText}>Create full backup (DB + photos)…</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white', padding: 16, gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginTop: 16, marginBottom: 4 },
  button: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#f0f0f0' },
  buttonText: { fontWeight: '600' },
});
