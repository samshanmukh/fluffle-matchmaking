import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { EASE_OUT, PRESS_MS } from '../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/** Feedback on press-in, on the UI thread: the control answers before the tap completes. */
export function PressableScale({ style, children, disabled, onPressIn, onPressOut, ...rest }: Props) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({
    // Scale only: opacity belongs to the caller (disabled controls dim themselves).
    transform: [{ scale: 1 - (reduced ? 0.01 : 0.03) * pressed.get() }],
  }));
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      pressRetentionOffset={16}
      onPressIn={(e) => {
        pressed.set(withTiming(1, { duration: PRESS_MS, easing: EASE_OUT }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.set(withTiming(0, { duration: PRESS_MS, easing: EASE_OUT }));
        onPressOut?.(e);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
