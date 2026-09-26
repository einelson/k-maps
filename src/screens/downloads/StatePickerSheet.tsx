import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { US_STATE_CELLS } from '../../downloads/stateCells';
import { US_STATES, type UsState } from '../../packs/usStates';
import { Text, TextInput, useThemedStyles, type ThemeColors } from '../../theme';
import { BottomSheet } from '../components/BottomSheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Codes of the states whose every square is picked. */
  picked: ReadonlySet<string>;
  /** Ids of the states that have a ready-made pack published (their land and trail data installs in one go). */
  packedIds: ReadonlySet<string>;
  /** Tapping a state picks all of it, or — when it is already picked whole — puts it back. */
  onToggle: (state: UsState) => void;
}

/** "Pick a whole state": the 50 states with how many squares each is, so a state is one tap instead of hundreds. */
export function StatePickerSheet({ visible, onClose, picked, packedIds, onToggle }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? US_STATES.filter((state) => state.name.toLowerCase().includes(needle)) : US_STATES;
  }, [query]);

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="85%">
      <Text style={styles.title}>Pick a whole state</Text>
      <Text style={styles.hint}>
        Picks every square of the state, so you can save map pictures for all of it — not just the land and trail data
        Ready-made offers.
      </Text>
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search states"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {shown.map((state) => {
          const on = picked.has(state.code);
          const squares = US_STATE_CELLS.cellsOf(state.code).length;
          return (
            <Pressable
              key={state.code}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              style={styles.row}
              onPress={() => onToggle(state)}
            >
              <View style={styles.rowText}>
                <Text style={styles.name}>{state.name}</Text>
                <Text style={styles.note}>
                  {squares} squares{packedIds.has(state.id) ? ' · ready-made land & trail data' : ''}
                </Text>
              </View>
              <Text style={on ? styles.picked : styles.pick}>{on ? 'Picked ✓' : 'Pick'}</Text>
            </Pressable>
          );
        })}
        {shown.length === 0 && <Text style={styles.note}>No state matches “{query}”.</Text>}
      </ScrollView>
      <Pressable style={styles.done} onPress={onClose} accessibilityRole="button">
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </BottomSheet>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    title: { fontSize: 16, fontWeight: '700' },
    hint: { fontSize: 12, color: c.textMuted, marginTop: 4, marginBottom: 8, lineHeight: 17 },
    search: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: c.field,
      marginBottom: 4,
    },
    list: { flexGrow: 0 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.divider,
    },
    rowText: { flex: 1 },
    name: { fontWeight: '600', fontSize: 15 },
    note: { fontSize: 12, color: c.textMuted, marginTop: 1 },
    pick: { color: c.primaryText, fontWeight: '600' },
    picked: { color: c.primaryText, fontWeight: '700' },
    done: { paddingVertical: 14, alignItems: 'center' },
    doneText: { color: c.primaryText, fontWeight: '700' },
  });
