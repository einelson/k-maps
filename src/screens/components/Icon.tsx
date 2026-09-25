import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import { useTheme } from '../../theme';

export type IconName =
  | 'layers'
  | 'filter'
  | 'plus'
  | 'close'
  | 'locate'
  | 'list'
  | 'download'
  | 'swap'
  | 'settings'
  | 'point'
  | 'line'
  | 'area'
  | 'measure'
  | 'record'
  | 'stop'
  | 'folder';

/** Icons are laid out on a 24-unit grid and scaled to whatever `size` is asked for. */
const GRID = 24;

interface IconProps {
  name: IconName;
  size?: number;
  /** Defaults to the theme's icon colour. */
  color?: string;
}

/**
 * Small glyph set drawn from plain Views, so the map chrome needs no icon font (and no native
 * rebuild). Swap for `@expo/vector-icons` if a richer set is ever needed.
 */
export function Icon({ name, size = GRID, color: colorProp }: IconProps) {
  const { colors } = useTheme();
  const color = colorProp ?? colors.icon;
  const k = size / GRID;
  const u = (n: number) => n * k;

  let key = 0;
  const shape = (style: ViewStyle) => <View key={key++} style={[{ position: 'absolute' }, style]} />;

  const rect = (x: number, y: number, w: number, h: number, extra: ViewStyle = {}) =>
    shape({
      left: u(x),
      top: u(y),
      width: u(w),
      height: u(h),
      borderRadius: u(Math.min(1.2, w / 2, h / 2)),
      backgroundColor: color,
      ...extra,
    });

  const disc = (cx: number, cy: number, d: number) =>
    shape({ left: u(cx - d / 2), top: u(cy - d / 2), width: u(d), height: u(d), borderRadius: u(d / 2), backgroundColor: color });

  const ring = (cx: number, cy: number, d: number, thickness: number) =>
    shape({
      left: u(cx - d / 2),
      top: u(cy - d / 2),
      width: u(d),
      height: u(d),
      borderRadius: u(d / 2),
      borderWidth: u(thickness),
      borderColor: color,
    });

  /**
   * An arrow-head: a square with two adjacent borders, turned 45° so the joined corner points
   * `dir`. `d` is half the head's width; `cy` is where the two arms end, `flat` squashes it into
   * the shallow chevrons of the layers icon.
   */
  const chevron = (dir: 'up' | 'down', cx: number, cy: number, d: number, thickness: number, flat = false) => {
    const side = (d * 2) / Math.SQRT2;
    return shape({
      left: u(cx - side / 2),
      top: u(cy - side / 2),
      width: u(side),
      height: u(side),
      borderColor: color,
      ...(dir === 'down'
        ? { borderRightWidth: u(thickness), borderBottomWidth: u(thickness) }
        : { borderLeftWidth: u(thickness), borderTopWidth: u(thickness) }),
      transform: flat ? [{ scaleY: 0.5 }, { rotate: '45deg' }] : [{ rotate: '45deg' }],
    });
  };

  const shapes = ((): ReactNode[] => {
    switch (name) {
      case 'plus':
        return [rect(11, 4, 2.6, 16), rect(4, 11, 16, 2.6)];
      case 'close':
        return [
          rect(3, 10.7, 18, 2.6, { transform: [{ rotate: '45deg' }] }),
          rect(3, 10.7, 18, 2.6, { transform: [{ rotate: '-45deg' }] }),
        ];
      case 'filter':
        return [rect(3, 5, 18, 2.6), rect(6, 10.7, 12, 2.6), rect(9.5, 16.4, 5, 2.6)];
      case 'layers': {
        const top = shape({
          left: u(12 - 7.07),
          top: u(7 - 7.07),
          width: u(14.14),
          height: u(14.14),
          borderWidth: u(2.4),
          borderColor: color,
          transform: [{ scaleY: 0.5 }, { rotate: '45deg' }],
        });
        return [top, chevron('down', 12, 11.5, 10, 2.4, true), chevron('down', 12, 16, 10, 2.4, true)];
      }
      case 'locate':
        return [
          ring(12, 12, 13, 2.2),
          disc(12, 12, 5),
          rect(10.9, 1.5, 2.2, 5),
          rect(10.9, 17.5, 2.2, 5),
          rect(1.5, 10.9, 5, 2.2),
          rect(17.5, 10.9, 5, 2.2),
        ];
      case 'list':
        return [0, 1, 2].flatMap((i) => [disc(4.5, 5.5 + i * 6.5, 3), rect(9.5, 5.5 + i * 6.5 - 1.3, 12, 2.6)]);
      case 'download':
        return [rect(10.8, 3, 2.4, 14), chevron('down', 12, 12, 5, 2.4), rect(4, 20, 16, 2.4)];
      case 'swap':
        return [
          rect(6.8, 4, 2.4, 16),
          chevron('up', 8, 7.5, 4, 2.4),
          rect(14.8, 4, 2.4, 16),
          chevron('down', 16, 16.5, 4, 2.4),
        ];
      case 'settings':
        return [
          // Eight teeth, each on a full-size wrapper turned around the centre, then the ring over them.
          ...Array.from({ length: 8 }, (_, i) => (
            <View
              key={`tooth-${i}`}
              style={{ position: 'absolute', left: 0, top: 0, width: u(GRID), height: u(GRID), transform: [{ rotate: `${i * 45}deg` }] }}
            >
              {rect(10.6, 0.8, 2.8, 5.2)}
            </View>
          )),
          ring(12, 12, 15, 4),
        ];
      case 'point':
        return [ring(12, 12, 17, 2.4), disc(12, 12, 6)];
      case 'line':
        return [
          rect(2, 10.8, 20, 2.4, { transform: [{ rotate: '-35deg' }] }),
          disc(3.8, 17.7, 5),
          disc(20.2, 6.3, 5),
        ];
      case 'area':
        return [
          shape({ left: u(5), top: u(5), width: u(14), height: u(14), borderWidth: u(2.2), borderColor: color }),
          disc(5, 5, 5),
          disc(19, 5, 5),
          disc(19, 19, 5),
          disc(5, 19, 5),
        ];
      case 'measure':
        return [
          shape({ left: u(1.5), top: u(7.5), width: u(21), height: u(9), borderWidth: u(2.2), borderColor: color, borderRadius: u(1.5) }),
          ...[5.5, 9.5, 13.5, 17.5].map((x) => rect(x, 9.5, 2, 4, { borderRadius: 0 })),
        ];
      case 'record':
        return [disc(12, 12, 14)];
      case 'stop':
        return [rect(6, 6, 12, 12, { borderRadius: u(2) })];
      case 'folder':
        // A tab on the back edge, then the body.
        return [rect(3, 4.5, 8.5, 5, { borderRadius: u(1.6) }), rect(3, 7.5, 18, 12, { borderRadius: u(2.2) })];
    }
  })();

  return <View style={{ width: size, height: size }}>{shapes}</View>;
}
