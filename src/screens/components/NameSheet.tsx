import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text, TextInput, useThemedStyles, type ThemeColors } from '../../theme';
import { BottomSheet } from './BottomSheet';

interface NameSheetProps {
  visible: boolean;
  title: string;
  placeholder: string;
  confirmLabel: string;
  /** Prefilled text (a rename starts from the current name). */
  initialValue?: string;
  /** Saves the name. Throw an Error to keep the sheet open and show its message. */
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}

/** A sheet with one text field — used to name a new folder or rename one. */
export function NameSheet({ visible, onClose, ...form }: NameSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {/* Mounted only while the sheet is open, so every opening starts from a fresh field. */}
      <NameForm {...form} onClose={onClose} />
    </BottomSheet>
  );
}

function NameForm({ title, placeholder, confirmLabel, initialValue = '', onSubmit, onClose }: Omit<NameSheetProps, 'visible'>) {
  const styles = useThemedStyles(makeStyles);
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <Text style={styles.title}>{title}</Text>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        value={value}
        onChangeText={setValue}
        onSubmitEditing={submit}
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.buttons}>
        <Pressable style={styles.cancel} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable style={[styles.confirm, busy && styles.confirmBusy]} onPress={submit} disabled={busy}>
          <Text style={styles.confirmText}>{confirmLabel}</Text>
        </Pressable>
      </View>
    </>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    title: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
    input: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: c.field },
    error: { color: c.danger, fontSize: 13, marginTop: 8 },
    buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 16 },
    cancel: { paddingHorizontal: 14, paddingVertical: 10 },
    cancelText: { color: c.textMuted, fontWeight: '600' },
    confirm: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, backgroundColor: c.primary },
    confirmBusy: { backgroundColor: c.disabled },
    confirmText: { color: c.onPrimary, fontWeight: '700' },
  });
