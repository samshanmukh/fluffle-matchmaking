import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { color } from '../theme';

/** The room every screen sits in: grey, with two patches of warm light for the glass to frost. */
export function Backdrop() {
  const { width, height } = useWindowDimensions();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="warm" cx="88%" cy="6%" rx="70%" ry="38%" gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor={color.accentWarm} stopOpacity={0.5} />
            <Stop offset="1" stopColor={color.accentWarm} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="ember" cx="8%" cy="78%" rx="75%" ry="36%" gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor={color.accent} stopOpacity={0.34} />
            <Stop offset="1" stopColor={color.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill={color.ground} />
        <Rect width={width} height={height} fill="url(#warm)" />
        <Rect width={width} height={height} fill="url(#ember)" />
      </Svg>
    </View>
  );
}
