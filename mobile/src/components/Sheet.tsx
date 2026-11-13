import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, font, radius, space } from '../theme';

/** The purple band at the top of every screen. */
export function Header({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  return <View style={[{ paddingTop: insets.top + space.s, paddingHorizontal: space.xl, paddingBottom: space.xl }, style]}>{children}</View>;
}

/** The light sheet below the header, where the screen's work happens. */
export function Sheet({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.sheet, style]}>{children}</View>;
}

/** "● Looking": the one-line status under a header title. */
export function StatusLine({ label, tone = 'live' }: { label: string; tone?: 'live' | 'warn' }) {
  return (
    <View style={styles.status}>
      <View style={[styles.dot, { backgroundColor: tone === 'live' ? color.live : color.warn }]} />
      <Text style={styles.statusLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: color.ground, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, overflow: 'hidden' },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { ...font.regular, fontSize: 13, lineHeight: 18, color: color.onAccentSoft, fontVariant: ['tabular-nums'], flexShrink: 1 },
});
