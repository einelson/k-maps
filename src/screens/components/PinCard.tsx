import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FEATURE_COLOR_PALETTE } from '../../features/colorPalette';
import type { PinStyleId } from '../../features/pinStyles';
import { addTagNames } from '../../features/tagInput';
import { Text, TextInput, useThemedStyles, type ThemeColors } from '../../theme';
import { PinStylePicker } from './PinStylePicker';
import { useKeyboardOverlap } from './useKeyboardOverlap';

/** What the new-pin card is editing. The location is fixed when the card opens (see MapScreen). */
export interface PinDraft {
  lngLat: [number, number];
  name: string;
  notes: string;
  color: string;
  icon: PinStyleId;
  tags: string[];
}

interface PinCardProps {
  draft: PinDraft;
  onChange: (patch: Partial<Omit<PinDraft, 'lngLat'>>) => void;
  /** Existing tag names, offered as one-tap suggestions. */
  knownTags: string[];
  /** The pin's position, already formatted in the user's chosen coordinate format. */
  coordinateText: string;
  /** Receives the final tag list — anything typed in the tag box but not yet added is included. */
  onSave: (tags: string[]) => void;
  onCancel: () => void;
  saving?: boolean;
}

const SLIDE_DISTANCE = 360;
const MAX_SUGGESTIONS = 12;
/** Height of the card apart from its scrolling fields: grabber, header and the Cancel/Save row. */
const CARD_CHROME = 190;

/**
 * The card that slides up from the bottom of the map when a pin is dropped: name, description,
 * colour, pin style and tags. The pin isn't saved until Save is pressed; the map shows it live
 * (MapScreen renders the draft) as colour and style change.
 */
export function PinCard({ draft, onChange, knownTags, coordinateText, onSave, onCancel, saving = false }: PinCardProps) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const wrapperRef = useRef<View>(null);
  const [slide] = useState(() => new Animated.Value(SLIDE_DISTANCE));
  const [tagText, setTagText] = useState('');
  const { overlap, keyboardTop, remeasure } = useKeyboardOverlap(wrapperRef, insets.bottom);

  useEffect(() => {
    Animated.timing(slide, { toValue: 0, duration: 220, useNativeDriver: true }).start();
  }, [slide]);

  // With the keyboard up the card's bottom edge sits on the keyboard's top, so it may grow until
  // its top reaches the status bar — leave room for the header and buttons.
  const scrollMaxHeight =
    keyboardTop != null
      ? Math.max(120, keyboardTop - insets.top - CARD_CHROME)
      : Math.round(windowHeight * 0.48);

  const suggestions = knownTags
    .filter((name) => !draft.tags.some((tag) => tag.toLowerCase() === name.toLowerCase()))
    .slice(0, MAX_SUGGESTIONS);

  function commitTagText(raw: string) {
    const next = addTagNames(draft.tags, raw, knownTags);
    onChange({ tags: next });
    setTagText('');
    return next;
  }

  function handleTagTextChange(text: string) {
    // A comma ends a tag, like most tag inputs.
    if (text.includes(',')) commitTagText(text);
    else setTagText(text);
  }

  return (
    <View ref={wrapperRef} pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.wrapper]} onLayout={remeasure}>
      <Animated.View style={[styles.card, { marginBottom: overlap, transform: [{ translateY: slide }] }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>New pin</Text>
            <Text style={styles.coordinates}>{coordinateText}</Text>
          </View>
          <Pressable accessibilityLabel="Discard pin" onPress={onCancel} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        <ScrollView
          style={{ maxHeight: scrollMaxHeight }}
          contentContainerStyle={styles.fields}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TextInput
            style={styles.input}
            value={draft.name}
            onChangeText={(name) => onChange({ name })}
            placeholder="Name"
            returnKeyType="next"
            maxLength={120}
          />
          <TextInput
            style={[styles.input, styles.notesInput]}
            value={draft.notes}
            onChangeText={(notes) => onChange({ notes })}
            placeholder="Description"
            multiline
          />

          <Text style={styles.label}>Color</Text>
          <View style={styles.colorRow}>
            {FEATURE_COLOR_PALETTE.map((color) => (
              <Pressable
                key={color}
                accessibilityRole="button"
                accessibilityLabel={`Color ${color}`}
                accessibilityState={{ selected: draft.color === color }}
                style={[styles.swatch, { backgroundColor: color }, draft.color === color && styles.swatchSelected]}
                onPress={() => onChange({ color })}
              />
            ))}
          </View>

          <Text style={styles.label}>Pin style</Text>
          <PinStylePicker value={draft.icon} color={draft.color} onChange={(icon) => onChange({ icon })} />

          <Text style={styles.label}>Tags</Text>
          <View style={styles.tagRow}>
            {draft.tags.map((tag) => (
              <Pressable
                key={tag}
                accessibilityLabel={`Remove tag ${tag}`}
                style={styles.tagChip}
                onPress={() => onChange({ tags: draft.tags.filter((t) => t !== tag) })}
              >
                <Text style={styles.tagChipText}>{tag} ✕</Text>
              </Pressable>
            ))}
            <TextInput
              style={styles.tagInput}
              value={tagText}
              onChangeText={handleTagTextChange}
              onSubmitEditing={() => commitTagText(tagText)}
              onBlur={() => tagText.trim() && commitTagText(tagText)}
              placeholder={draft.tags.length ? 'Add another…' : 'Add a tag…'}
              autoCapitalize="none"
              returnKeyType="done"
              blurOnSubmit={false}
              maxLength={40}
            />
          </View>
          {suggestions.length > 0 && (
            <View style={styles.tagRow}>
              {suggestions.map((name) => (
                <Pressable
                  key={name}
                  style={styles.suggestionChip}
                  onPress={() => onChange({ tags: addTagNames(draft.tags, name, knownTags) })}
                >
                  <Text style={styles.suggestionChipText}>+ {name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>

        <View style={styles.actions}>
          <Pressable style={[styles.button, styles.cancelButton]} onPress={onCancel} disabled={saving}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.saveButton, saving && styles.buttonDisabled]}
            onPress={() => onSave(commitTagText(tagText))}
            disabled={saving}
          >
            <Text style={styles.saveText}>Save pin</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    // Fills the map area but lets touches through everywhere except the card itself.
    wrapper: { justifyContent: 'flex-end' },
    card: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 16,
      paddingBottom: 12,
      elevation: 12,
      shadowColor: c.shadow,
      shadowOpacity: 0.25,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: -2 },
    },
    grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.handle, marginTop: 8 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, paddingBottom: 4 },
    headerText: { flex: 1 },
    title: { fontSize: 18, fontWeight: '700' },
    coordinates: { fontSize: 12, color: c.textMuted, marginTop: 1 },
    close: { fontSize: 18, color: c.textFaint, paddingHorizontal: 4 },
    fields: { paddingBottom: 8, gap: 2 },
    input: {
      marginTop: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: c.field,
      fontSize: 16,
    },
    notesInput: { minHeight: 76, textAlignVertical: 'top' },
    label: { fontSize: 12, color: c.textFaint, marginTop: 14, textTransform: 'uppercase', fontWeight: '600' },
    colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 8 },
    swatch: { width: 30, height: 30, borderRadius: 15 },
    swatchSelected: { borderWidth: 3, borderColor: c.selectionRing },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingVertical: 6 },
    tagChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: c.primaryTint },
    tagChipText: { fontSize: 13, fontWeight: '600', color: c.primaryText },
    tagInput: {
      minWidth: 120,
      flexGrow: 1,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 14,
      backgroundColor: c.field,
      fontSize: 14,
    },
    suggestionChip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.primaryText,
    },
    suggestionChipText: { fontSize: 12, fontWeight: '600', color: c.primaryText },
    actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
    button: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
    cancelButton: { backgroundColor: c.chip },
    cancelText: { fontWeight: '700', color: c.textSecondary },
    saveButton: { backgroundColor: c.primary, flex: 2 },
    saveText: { fontWeight: '700', color: c.onPrimary },
    buttonDisabled: { opacity: 0.5 },
  });
