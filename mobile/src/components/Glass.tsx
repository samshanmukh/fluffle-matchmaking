import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { color, radius } from '../theme';

interface Props {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Corner radius of the panel. */
  round?: number;
  /** Floating bars sit over busier content and need more frost to stay legible. */
  strong?: boolean;
}

/**
 * A frosted panel: a static blur of whatever is behind it, a wash of white,
 * and a bright edge. The blur never animates; panels fade as a whole.
 */
export function Glass({ children, style, round = radius.card, strong = false }: Props) {
  return (
    <View style={[styles.frame, { borderRadius: round }, style]}>
      <BlurView intensity={strong ? 60 : 40} tint="light" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: strong ? color.glassStrong : color.glass }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', borderWidth: 1, borderColor: color.glassEdge },
});
