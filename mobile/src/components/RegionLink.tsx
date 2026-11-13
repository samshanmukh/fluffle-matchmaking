import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { flag, regionName } from '../regions';
import { color, space } from '../theme';
import { Tag } from './Tag';

/** Where the two of you are connecting from: your flag, theirs, and the line between. */
export function RegionLink({ mine, theirs }: { mine: string | null; theirs: string | null }) {
  if (mine && mine === theirs) {
    return (
      <View style={styles.row}>
        <Tag emoji={flag(mine)} label={`You're both in ${regionName(mine)}`} />
      </View>
    );
  }
  return (
    <View style={styles.row}>
      <Tag emoji={flag(mine)} label={regionName(mine)} />
      <Ionicons name="swap-horizontal" size={16} color={color.onAccentSoft} />
      <Tag emoji={flag(theirs)} label={regionName(theirs)} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s, maxWidth: '100%' },
});
