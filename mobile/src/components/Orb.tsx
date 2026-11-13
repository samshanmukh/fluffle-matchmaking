import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { color } from '../theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Countdown {
  /** Fraction of the window left when the orb appeared, 0..1. */
  startFraction: number;
  /** Milliseconds until it is empty. */
  remainingMs: number;
  /**
   * The user has answered, so the ring is dimmed. It deliberately keeps
   * draining: the offer still expires at the same moment for the partner, and
   * a ring that stopped would show time the offer does not have.
   */
  frozen: boolean;
}

interface Props {
  /** Diameter of the glowing halo; the disc is about 45% of it. */
  size: number;
  /** Breathe slowly: "still looking". Off when there is a countdown to read. */
  breathing?: boolean;
  countdown?: Countdown;
  children: ReactNode;
}

/**
 * The glowing disc at the centre of the waiting, offer and call screens.
 * The halo breathes on the UI thread; a countdown, when given, drains a white
 * ring around the disc at the real rate.
 */
export function Orb({ size, breathing = false, countdown, children }: Props) {
  const reduced = useReducedMotion();
  const disc = size * 0.46;
  const ringStroke = 6;
  const ringR = disc / 2 + 10;
  const circumference = 2 * Math.PI * ringR;

  const breath = useSharedValue(0);
  useEffect(() => {
    if (!breathing || reduced) return;
    breath.set(withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(breath);
  }, [breathing, reduced, breath]);
  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.82 + 0.18 * breath.get(),
    transform: [{ scale: 0.92 + 0.1 * breath.get() }],
  }));

  const left = useSharedValue(countdown?.startFraction ?? 0);
  useEffect(() => {
    if (!countdown) return;
    left.set(countdown.startFraction);
    left.set(withTiming(0, { duration: Math.max(0, countdown.remainingMs), easing: Easing.linear }));
    // Started once per offer: the deadline does not move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - left.get()) }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[StyleSheet.absoluteFill, haloStyle]}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={color.accent} stopOpacity={0.95} />
              <Stop offset="0.45" stopColor={color.accent} stopOpacity={0.6} />
              <Stop offset="0.75" stopColor={color.accentWarm} stopOpacity={0.28} />
              <Stop offset="1" stopColor={color.accentWarm} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#halo)" />
        </Svg>
      </Animated.View>

      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="disc" cx="50%" cy="42%" r="60%">
            <Stop offset="0" stopColor={color.accent} stopOpacity={1} />
            <Stop offset="1" stopColor={color.accentWarm} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={disc / 2} fill="url(#disc)" stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} />
        {countdown && (
          <>
            <Circle cx={size / 2} cy={size / 2} r={ringR} stroke="rgba(255,255,255,0.3)" strokeWidth={ringStroke} fill="none" />
            <AnimatedCircle
              cx={size / 2}
              cy={size / 2}
              r={ringR}
              stroke="#FFFFFF"
              strokeWidth={ringStroke}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={circumference}
              animatedProps={ringProps}
              opacity={countdown.frozen ? 0.5 : 1}
              rotation={-90}
              origin={`${size / 2}, ${size / 2}`}
            />
          </>
        )}
      </Svg>

      <View style={{ width: disc, height: disc, alignItems: 'center', justifyContent: 'center' }}>{children}</View>
    </View>
  );
}
