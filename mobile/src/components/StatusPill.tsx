import { StyleSheet, Text, View } from 'react-native';

import { color, font } from '../theme';

/** The small "● Looking" line at the top of a screen: what the app is doing right now. */
export function StatusPill({ label, tone = 'live' }: { label: string; tone?: 'live' | 'accent' | 'warn' | 'idle' }) {
  const dot = tone === 'live' ? color.live : tone === 'accent' ? color.accent : tone === 'warn' ? color.warn : color.inkFaint;
  return (
    <View style={styles.row} accessibilityRole="text">
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  label: { fontFamily: font.medium, fontSize: 18, lineHeight: 24, color: color.ink },
});
