import { StyleSheet, Text } from 'react-native';

import { color, font, radius } from '../theme';
import { PressableScale } from './PressableScale';

interface Props {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}

export function Chip({ label, selected, disabled = false, onPress }: Props) {
  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.selected, disabled && styles.disabled]}
    >
      <Text style={[styles.label, selected && styles.labelSelected]} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: 46, borderRadius: radius.pill, paddingHorizontal: 20, justifyContent: 'center', backgroundColor: color.solid },
  selected: { backgroundColor: color.accent },
  disabled: { opacity: 0.4 },
  label: { fontFamily: font.medium, fontSize: 16, lineHeight: 22, color: color.ink },
  labelSelected: { color: color.onAccent },
});
