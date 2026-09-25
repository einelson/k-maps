import { Pressable, StyleSheet, View } from 'react-native';

import type { DrawTool } from '../../state/types';
import { Text, useTheme, useThemedStyles, type ThemeColors } from '../../theme';
import { Icon, type IconName } from './Icon';

type AddTool = Exclude<DrawTool, 'none'>;

const TOOLS: { id: AddTool; label: string; icon: IconName }[] = [
  { id: 'point', label: 'Point', icon: 'point' },
  { id: 'line', label: 'Line', icon: 'line' },
  { id: 'polygon', label: 'Area', icon: 'area' },
  { id: 'measure', label: 'Measure', icon: 'measure' },
];

const FAB_SIZE = 56;
const FAB_MARGIN = 16;

interface AddMenuProps {
  open: boolean;
  onToggle: () => void;
  /** The draw tool currently armed, if any — highlighted in the menu. */
  activeTool: DrawTool;
  recording: boolean;
  onSelectTool: (tool: AddTool) => void;
  onToggleTrack: () => void;
}

/**
 * The map's "+" button. Tapping it fans out everything you can create on the map — point, line,
 * area, measure, and GPS track recording. The menu grows upward from the button, nearest item
 * first, so the most-used tool is the easiest thumb reach.
 */
export function AddMenu({ open, onToggle, activeTool, recording, onSelectTool, onToggleTrack }: AddMenuProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      {open && (
        <View style={styles.menu}>
          {TOOLS.map((tool) => (
            <MenuItem
              key={tool.id}
              label={tool.label}
              icon={tool.icon}
              active={activeTool === tool.id}
              onPress={() => onSelectTool(tool.id)}
            />
          ))}
          <MenuItem
            label={recording ? 'Track stats' : 'Record track'}
            icon={recording ? 'stop' : 'record'}
            iconColor={colors.danger}
            danger={recording}
            onPress={onToggleTrack}
          />
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Close add menu' : 'Add to map'}
        style={styles.fab}
        onPress={onToggle}
      >
        <Icon name={open ? 'close' : 'plus'} size={26} color={colors.onPrimary} />
        {recording && !open && <View style={styles.recordingDot} />}
      </Pressable>
    </View>
  );
}

function MenuItem({
  label,
  icon,
  onPress,
  active = false,
  danger = false,
  iconColor,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  iconColor?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.item, active && styles.itemActive, danger && styles.itemDanger]}
      onPress={onPress}
    >
      <Text style={[styles.itemLabel, active && styles.itemLabelActive, danger && styles.itemLabelDanger]}>
        {label}
      </Text>
      <Icon name={icon} size={20} color={active ? colors.onPrimary : (iconColor ?? colors.primaryText)} />
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrap: { position: 'absolute', right: FAB_MARGIN, bottom: FAB_MARGIN, alignItems: 'flex-end' },
    menu: { flexDirection: 'column-reverse', alignItems: 'flex-end', gap: 8, marginBottom: 12 },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      height: 44,
      paddingLeft: 16,
      paddingRight: 14,
      borderRadius: 22,
      backgroundColor: c.surface,
      elevation: 4,
      shadowColor: c.shadow,
      shadowOpacity: 0.2,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
    },
    itemActive: { backgroundColor: c.primary },
    itemDanger: { backgroundColor: c.dangerTint },
    itemLabel: { fontWeight: '600', fontSize: 14, color: c.text },
    itemLabelActive: { color: c.onPrimary },
    itemLabelDanger: { color: c.danger },
    fab: {
      width: FAB_SIZE,
      height: FAB_SIZE,
      borderRadius: FAB_SIZE / 2,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 6,
      shadowColor: c.shadow,
      shadowOpacity: 0.3,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
    },
    recordingDot: {
      position: 'absolute',
      top: 2,
      right: 2,
      width: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: c.danger,
      borderWidth: 2,
      borderColor: c.surface,
    },
  });
