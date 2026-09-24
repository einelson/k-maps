import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Dimensions, Keyboard, Platform, type View } from 'react-native';

/**
 * How far the on-screen keyboard covers the bottom of `wrapperRef`'s box, and where its top edge
 * is (window coordinates, `null` while it's hidden).
 *
 * Measured rather than assumed: if the OS resizes the window for the keyboard the overlap is
 * already 0; with edge-to-edge (no resize) the caller has to lift itself by `overlap`.
 *
 * On Android the keyboard's top is derived from its height and the navigation-bar inset rather
 * than taken from the event's `screenY`. React Native reports the height *without* the
 * navigation bar, and computes `screenY` from a "visible frame" that edge-to-edge doesn't shrink
 * for the keyboard — trusting it left content sitting a nav-bar-height too low, behind the keys.
 */
export function useKeyboardOverlap(wrapperRef: RefObject<View | null>, navBarInset: number) {
  const [overlap, setOverlap] = useState(0);
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  const keyboardTopRef = useRef<number | null>(null);
  const navBarInsetRef = useRef(navBarInset);
  useEffect(() => {
    navBarInsetRef.current = navBarInset;
  }, [navBarInset]);

  const remeasure = useCallback(() => {
    const top = keyboardTopRef.current;
    if (top == null) return;
    wrapperRef.current?.measureInWindow((_x, y, _w, h) => setOverlap(Math.max(0, Math.round(y + h - top))));
  }, [wrapperRef]);

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      const { screenY, height } = event.endCoordinates;
      const top = ios ? screenY : Dimensions.get('screen').height - navBarInsetRef.current - height;
      keyboardTopRef.current = top;
      setKeyboardTop(top);
      // Android may resize the window just after the event; the wrapper's onLayout re-measures too.
      setTimeout(remeasure, ios ? 0 : 50);
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      keyboardTopRef.current = null;
      setKeyboardTop(null);
      setOverlap(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [remeasure]);

  return { overlap, keyboardTop, remeasure };
}
