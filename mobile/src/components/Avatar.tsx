import { Image, StyleSheet, Text, View } from 'react-native';

import { flag } from '../regions';
import { color } from '../theme';

// A person, until there are real photos: one of a small cast of clay figures.
// Which figure someone gets comes from a number derived from their id, never
// from their region: people from one country look every sort of way. The
// region shows as a flag badge on the corner.
const CAST = [
  { image: require('../../assets/avatars/person-1.png'), tint: '#DCD3F6' },
  { image: require('../../assets/avatars/person-2.png'), tint: '#F8CFD6' },
  { image: require('../../assets/avatars/person-3.png'), tint: '#CFE0FA' },
  { image: require('../../assets/avatars/person-4.png'), tint: '#FBE3B4' },
  { image: require('../../assets/avatars/person-5.png'), tint: '#CDEEE3' },
];

/** FNV-1a. The server uses the same function for the avatar codes it sends. */
export function avatarCode(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

interface Props {
  /** The person: their user id, or the avatar code the server sent for them. */
  person: string | number;
  size: number;
  /** When given (even as null, for "unknown"), a flag badge is drawn on the corner. */
  region?: string | null;
}

export function Avatar({ person, size, region }: Props) {
  const code = typeof person === 'number' ? person >>> 0 : avatarCode(person);
  const figure = CAST[code % CAST.length];
  const badge = Math.max(18, Math.round(size * 0.36));
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.disc, { borderRadius: size / 2, backgroundColor: figure.tint }]}>
        <Image source={figure.image} style={styles.image} resizeMode="cover" />
      </View>
      {region !== undefined && (
        <View style={[styles.badge, { width: badge, height: badge, borderRadius: badge / 2 }]}>
          <Text style={{ fontSize: badge * 0.62, lineHeight: badge * 0.86 }} allowFontScaling={false}>
            {flag(region)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { flex: 1, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  badge: { position: 'absolute', right: -2, bottom: -2, backgroundColor: color.solid, alignItems: 'center', justifyContent: 'center' },
});
