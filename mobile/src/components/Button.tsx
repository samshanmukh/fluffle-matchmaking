import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text } from 'react-native';

import { color, font, radius } from '../theme';
import { PressableScale } from './PressableScale';

type Variant = 'accent' | 'ink' | 'solid';

const FILL: Record<Variant, string> = { accent: color.accent, ink: color.ink, solid: color.solid };
const INK: Record<Variant, string> = { accent: color.onAccent, ink: '#FFFFFF', solid: color.ink };

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
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { backgroundColor: FILL[variant] }, disabled && styles.disabled]}
    >
      {icon && <Ionicons name={icon} size={20} color={INK[variant]} />}
      <Text style={[styles.label, { color: INK[variant] }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 60,
    borderRadius: radius.pill,
    paddingHorizontal: 24,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  label: { fontFamily: font.medium, fontSize: 18, lineHeight: 24, flexShrink: 1 },
});
