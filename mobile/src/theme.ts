import { Easing } from 'react-native-reanimated';

// The look: a purple header that says where you are, and a light sheet with
// rounded shoulders below it that holds what you do. Flat white cards, dark
// violet for what is selected, purple for the one main action.
export const color = {
  accent: '#6A5BC4',
  accentLight: '#8E80E0',
  onAccent: '#FFFFFF',
  onAccentSoft: 'rgba(255,255,255,0.74)',
  ground: '#F5F5F7',
  solid: '#FFFFFF',
  ink: '#1C1B29',
  inkSoft: '#77768A',
  inkFaint: '#A9A8B8',
  /** Chosen chips: a darker violet than the header, with white text. */
  selected: '#3E2F86',
  onSelected: '#FFFFFF',
  tint: 'rgba(106,91,196,0.12)',
  live: '#5ED36A',
  warn: '#F2B84B',
  danger: '#E5547A',
  off: '#C9C8D6',
};

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 22, xxl: 28, edge: 20 };
export const radius = { card: 20, sheet: 34, pill: 999 };

export const font = {
  regular: { fontFamily: 'Outfit_400Regular' },
  medium: { fontFamily: 'Outfit_500Medium' },
  semibold: { fontFamily: 'Outfit_600SemiBold' },
} as const;

export const type = {
  display: { ...font.medium, fontSize: 30, lineHeight: 36, letterSpacing: -0.4 },
  title: { ...font.medium, fontSize: 18, lineHeight: 23 },
  body: { ...font.regular, fontSize: 15, lineHeight: 21 },
  bodyStrong: { ...font.medium, fontSize: 15, lineHeight: 21 },
  small: { ...font.regular, fontSize: 13, lineHeight: 18 },
} as const;

export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const PRESS_MS = 120;
