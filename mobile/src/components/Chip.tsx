import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text } from 'react-native';

import { color, font, radius } from '../theme';
import { PressableScale } from './PressableScale';

interface Props {
  label: string;
  selected: boolean;
  /** Shown before the label. When selected and there is no icon, a check takes its place. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** A flag or other emoji shown before the label, in place of an icon. */
  emoji?: string;
  /** 'radio' for pick-one groups, 'checkbox' for pick-many. */
  role?: 'checkbox' | 'radio';
  disabled?: boolean;
  onPress: () => void;
}

export function Chip({ label, selected, icon, emoji, role = 'checkbox', disabled = false, onPress }: Props) {
  const glyph = icon ?? (selected && !emoji ? 'checkmark' : undefined);
  return (
    <PressableScale
      accessibilityRole={role}
      accessibilityState={{ checked: selected, selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.selected, disabled && styles.disabled]}
    >
      {emoji && (
        <Text style={styles.emoji} allowFontScaling={false}>
          {emoji}
        </Text>
      )}
      {glyph && <Ionicons name={glyph} size={17} color={selected ? color.onSelected : color.ink} />}
      <Text style={[styles.label, selected && styles.labelSelected]} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // 44pt tall to touch, even though it looks lighter than that.
  chip: { minHeight: 44, borderRadius: radius.pill, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: color.solid },
  selected: { backgroundColor: color.selected },
  disabled: { opacity: 0.4 },
  emoji: { fontSize: 15, lineHeight: 20 },
  label: { ...font.regular, fontSize: 15, lineHeight: 20, color: color.ink },
  labelSelected: { ...font.medium, color: color.onSelected },
});
