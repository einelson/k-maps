import { useState } from 'react';
import { LayoutAnimation, StyleSheet, View } from 'react-native';

import { useFiltersStore } from '../../state/useFiltersStore';
import { countActiveFilterCategories, FilterChipBar } from './FilterChipBar';
import { MapButton } from './MapButton';

/**
 * The map's top-left filter button. Collapsed it's a single round button (with a count bubble when
 * filters are applied, so hidden filters are never a surprise); tapping it slides the filter chip
 * bar out to its right.
 */
export function FilterControl() {
  const filters = useFiltersStore((s) => s.filters);
  const [expanded, setExpanded] = useState(false);

  function toggle() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((open) => !open);
  }

  return (
    // box-none: the empty part of the row must not swallow map pans.
    <View pointerEvents="box-none" style={styles.row}>
      <MapButton
        icon="filter"
        label={expanded ? 'Hide filters' : 'Show filters'}
        active={expanded}
        badge={countActiveFilterCategories(filters)}
        onPress={toggle}
      />
      {expanded && <FilterChipBar />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
