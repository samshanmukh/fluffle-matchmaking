import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text } from 'react-native';

import { color, font, radius } from '../theme';
import { PressableScale } from './PressableScale';

type Variant = 'accent' | 'solid' | 'danger';

const FILL: Record<Variant, string> = { accent: color.accent, solid: color.ground, danger: color.danger };
const INK: Record<Variant, string> = { accent: color.onAccent, solid: color.ink, danger: '#FFFFFF' };

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
}

export function Button({ label, onPress, variant = 'accent', icon, disabled = false }: Props) {
  return (
    <PressableScale
      accessibilityRole="button"
      // Named explicitly: otherwise the icon's glyph becomes part of what a screen reader says.
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { backgroundColor: FILL[variant] }, disabled && styles.disabled]}
    >
      {icon && <Ionicons name={icon} size={18} color={INK[variant]} />}
      <Text style={[styles.label, { color: INK[variant] }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 50, borderRadius: radius.pill, paddingHorizontal: 22, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  label: { ...font.medium, fontSize: 16, lineHeight: 22, flexShrink: 1 },
});
