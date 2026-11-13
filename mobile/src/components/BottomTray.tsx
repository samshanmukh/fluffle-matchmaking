import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, radius, space } from '../theme';

/** Space the tray takes at the bottom of the sheet around `content` points of content. */
export function useTrayHeight(content = 0): number {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom, space.m) + space.m + content;
}

/** The white panel at the foot of the sheet that holds the screen's actions, always in reach. */
export function BottomTray({ children }: { children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.tray, { paddingBottom: Math.max(insets.bottom, space.m) }]}>{children}</View>;
}

const styles = StyleSheet.create({
  tray: {
    backgroundColor: color.solid,
    borderTopLeftRadius: radius.sheet - 6,
    borderTopRightRadius: radius.sheet - 6,
    paddingTop: space.m,
    paddingHorizontal: space.l,
    gap: space.s,
  },
});
