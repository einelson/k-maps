import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSQLiteContext } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addPhoto, deletePhoto, listPhotos } from '../../data/photosRepo';
import type { Photo } from '../../data/types';
import { Text, useThemedStyles, type ThemeColors } from '../../theme';

const PICK_QUALITY = 0.8;

/**
 * Android can kill the activity while the camera/picker is open, losing the
 * JS promise. `getPendingResultAsync` recovers the result, but it doesn't say
 * which feature it was for (and after a full process restart the user may be
 * looking at a different feature), so the target is persisted before launching.
 */
const PENDING_TARGET_KEY = 'photos.pendingFeatureId';

async function rememberPendingTarget(featureId: number | null): Promise<void> {
  try {
    if (featureId == null) await Storage.removeItemAsync(PENDING_TARGET_KEY);
    else await Storage.setItemAsync(PENDING_TARGET_KEY, String(featureId));
  } catch {
    // Best effort — without it a killed-activity result just can't be recovered.
  }
}

async function readPendingTarget(): Promise<number | null> {
  try {
    const raw = await Storage.getItemAsync(PENDING_TARGET_KEY);
    const id = raw == null ? NaN : Number(raw);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

/** Picker asset URIs already saved this session, so a result delivered both ways can't add a photo twice. */
const handledAssetUris = new Set<string>();

interface PhotoStripProps {
  featureId: number;
}

/** Photos section of the feature editor (§8 item 5): thumbnail strip, add (camera/library), full-screen viewer with delete. */
export function PhotoStrip({ featureId }: PhotoStripProps) {
  const db = useSQLiteContext();
  const styles = useThemedStyles(makeStyles);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [viewing, setViewing] = useState<Photo | null>(null);
  const [brokenIds, setBrokenIds] = useState<Set<number>>(new Set());

  const reload = useCallback(async () => {
    setPhotos(await listPhotos(db, featureId));
  }, [db, featureId]);

  const saveAssets = useCallback(
    async (assets: ImagePicker.ImagePickerAsset[]) => {
      let failed = 0;
      for (const asset of assets) {
        if (handledAssetUris.has(asset.uri)) continue;
        handledAssetUris.add(asset.uri);
        try {
          await addPhoto(db, featureId, asset.uri);
        } catch {
          failed += 1;
        }
      }
      await reload();
      if (failed > 0) {
        Alert.alert(
          'Could not save photo',
          failed === 1 ? 'One photo could not be saved.' : `${failed} photos could not be saved.`
        );
      }
    },
    [db, featureId, reload]
  );

  useEffect(() => {
    let cancelled = false;
    listPhotos(db, featureId)
      .then((rows) => {
        if (!cancelled) setPhotos(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [db, featureId]);

  // Recover a photo whose camera/picker activity was killed by Android (no-op elsewhere).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const target = await readPendingTarget();
      if (target !== featureId || cancelled) return;
      const pending = await ImagePicker.getPendingResultAsync();
      await rememberPendingTarget(null);
      if (pending && 'assets' in pending && !pending.canceled) {
        await saveAssets(pending.assets);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [featureId, saveAssets]);

  async function launch(source: 'camera' | 'library') {
    await rememberPendingTarget(featureId);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          explainCameraDenied(permission.canAskAgain);
          return;
        }
      }
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: PICK_QUALITY })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              allowsMultipleSelection: true,
              quality: PICK_QUALITY,
            });
      if (!result.canceled) await saveAssets(result.assets);
    } catch (e) {
      Alert.alert('Could not add photo', e instanceof Error ? e.message : String(e));
    } finally {
      await rememberPendingTarget(null);
    }
  }

  function explainCameraDenied(canAskAgain: boolean) {
    Alert.alert(
      'Camera access needed',
      'K-Maps needs camera access to take photos for this item. You can still choose photos from your library.',
      canAskAgain
        ? [{ text: 'OK' }]
        : [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
    );
  }

  function promptAdd() {
    Alert.alert('Add photo', undefined, [
      { text: 'Take photo', onPress: () => launch('camera') },
      { text: 'Choose from library', onPress: () => launch('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function confirmDelete(photo: Photo) {
    Alert.alert('Delete photo?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePhoto(db, photo);
          } finally {
            setViewing(null);
            await reload();
          }
        },
      },
    ]);
  }

  function markBroken(id: number) {
    setBrokenIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  return (
    <View>
      {photos.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {photos.map((photo) => (
            <Pressable key={photo.id} onPress={() => setViewing(photo)}>
              {brokenIds.has(photo.id) ? (
                <View style={[styles.thumb, styles.thumbMissing]}>
                  <Text style={styles.thumbMissingText}>Missing</Text>
                </View>
              ) : (
                <Image
                  source={{ uri: photo.path }}
                  style={styles.thumb}
                  resizeMode="cover"
                  onError={() => markBroken(photo.id)}
                />
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}
      <View style={styles.addRow}>
        <Pressable style={styles.addChip} onPress={promptAdd}>
          <Text style={styles.addChipText}>+ Add photo</Text>
        </Pressable>
      </View>

      <Modal
        visible={viewing != null}
        animationType="fade"
        onRequestClose={() => setViewing(null)}
      >
        <SafeAreaView style={styles.viewer}>
          {viewing &&
            (brokenIds.has(viewing.id) ? (
              <View style={styles.viewerImage}>
                <Text style={styles.viewerMissing}>This photo&apos;s file is missing.</Text>
              </View>
            ) : (
              <Image
                source={{ uri: viewing.path }}
                style={styles.viewerImage}
                resizeMode="contain"
                onError={() => markBroken(viewing.id)}
              />
            ))}
          <View style={styles.viewerBar}>
            <Pressable style={styles.viewerButton} onPress={() => setViewing(null)}>
              <Text style={styles.viewerButtonText}>Close</Text>
            </Pressable>
            <Pressable
              style={styles.viewerButton}
              onPress={() => viewing && confirmDelete(viewing)}
            >
              <Text style={[styles.viewerButtonText, styles.viewerDeleteText]}>Delete</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    strip: { gap: 8, paddingVertical: 8 },
    thumb: { width: 88, height: 88, borderRadius: 8, backgroundColor: c.chip },
    thumbMissing: { alignItems: 'center', justifyContent: 'center' },
    thumbMissingText: { fontSize: 11, color: c.textFaint },
    addRow: { flexDirection: 'row', paddingVertical: 8 },
    addChip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.primaryText,
    },
    addChipText: { fontSize: 12, fontWeight: '600', color: c.primaryText },
    // The full-screen photo viewer is black in both themes — photos read best on black.
    viewer: { flex: 1, backgroundColor: 'black' },
    viewerImage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    viewerMissing: { color: 'white' },
    viewerBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    viewerButton: { paddingVertical: 12, paddingHorizontal: 8 },
    viewerButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
    viewerDeleteText: { color: '#e57373' },
  });
