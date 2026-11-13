import { Easing } from 'react-native-reanimated';

// The look: a soft grey room, warm light behind frosted glass, one orange.
// Glass panels are translucent white over a blurred backdrop; the orange glow
// behind them is what gives the frost something to catch.
export const color = {
  ground: '#E7E7E9',
  ink: '#151515',
  inkSoft: '#6B6B70',
  inkFaint: '#9A9AA0',
  accent: '#F04A1D',
  accentDeep: '#D93A10',
  accentWarm: '#FF8A3C',
  onAccent: '#FFFFFF',
  solid: '#FFFFFF',
  glass: 'rgba(255,255,255,0.58)',
  glassStrong: 'rgba(255,255,255,0.78)',
  glassEdge: 'rgba(255,255,255,0.9)',
  live: '#1FA971',
  warn: '#C77700',
};

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32, edge: 20 };
export const radius = { card: 32, bar: 40, pill: 999 };

export const font = { regular: 'Outfit_400Regular', medium: 'Outfit_500Medium', semibold: 'Outfit_600SemiBold' };

export const type = {
  display: { fontFamily: font.medium, fontSize: 38, lineHeight: 44, letterSpacing: -0.6 },
  title: { fontFamily: font.medium, fontSize: 22, lineHeight: 28, letterSpacing: -0.2 },
  body: { fontFamily: font.regular, fontSize: 17, lineHeight: 24 },
  bodyStrong: { fontFamily: font.medium, fontSize: 17, lineHeight: 24 },
  small: { fontFamily: font.regular, fontSize: 15, lineHeight: 21 },
} as const;

export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const PRESS_MS = 120;
