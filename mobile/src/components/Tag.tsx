import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { color, font, radius } from '../theme';

/** A fact at a glance: a language you share, the topic you agreed on. Not pressable. */
export function Tag({ label, icon, emoji }: { label: string; icon?: keyof typeof Ionicons.glyphMap; emoji?: string }) {
  return (
    <View style={styles.tag}>
      {emoji && (
        <Text style={styles.emoji} allowFontScaling={false}>
          {emoji}
        </Text>
      )}
      {icon && <Ionicons name={icon} size={14} color={color.ink} />}
      <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 30, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: color.solid, maxWidth: '100%', flexShrink: 1 },
  emoji: { fontSize: 14, lineHeight: 19 },
  label: { ...font.regular, fontSize: 13, lineHeight: 18, color: color.ink, flexShrink: 1 },
});
