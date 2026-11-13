import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Glass } from '../components/Glass';
import { Orb } from '../components/Orb';
import { StatusPill } from '../components/StatusPill';
import { clock, label, list } from '../copy';
import type { CallView } from '../session/reducer';
import { color, font, radius, space, type } from '../theme';
import { useNow } from '../useNow';

interface Props {
  view: CallView;
  onEnd: () => void;
}

export function CallScreen({ view, onEnd }: Props) {
  const insets = useSafeAreaInsets();
  const now = useNow(500);
  const time = clock(now - view.startedAt);
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, space.m) }]}>
      <StatusPill label="On a call" />
      <View style={styles.top}>
        <Text style={styles.h1} accessibilityRole="header">
          Talking with
        </Text>
        <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>
          {view.partnerName}
        </Text>
      </View>

      <View style={styles.middle}>
        <Orb size={300} breathing>
          <Text style={styles.time} accessibilityLabel={`Call time ${time}`} maxFontSizeMultiplier={1.1}>
            {time}
          </Text>
        </Orb>
      </View>

      <View style={styles.bottom}>
        <Glass style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Speaking</Text>
            <Text style={styles.rowValue}>{list(view.languages)}</Text>
          </View>
          <View style={styles.gap} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Topic</Text>
            <Text style={styles.rowValue}>{view.topic ? label(view.topic) : 'No agreed topic'}</Text>
            {!view.topic && <Text style={styles.rowNote}>You didn't pick the same one, so talk about anything.</Text>}
          </View>
        </Glass>
        <Glass round={radius.bar} strong style={styles.bar}>
          <Button label="End call" icon="call" variant="ink" onPress={onEnd} />
          <Text style={styles.note}>This prototype has no audio. This screen stands in for the call.</Text>
        </Glass>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.m },
  top: { alignItems: 'center', paddingHorizontal: space.s, marginTop: space.s },
  h1: { ...type.display, color: color.ink, textAlign: 'center' },
  name: { ...type.display, fontFamily: font.regular, color: color.inkSoft, textAlign: 'center' },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 150 },
  time: { fontFamily: font.medium, fontSize: 42, lineHeight: 48, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  bottom: { gap: space.s },
  card: { padding: space.edge },
  row: {},
  gap: { height: space.l },
  rowLabel: { ...type.small, color: color.inkSoft },
  rowValue: { fontFamily: font.medium, fontSize: 26, lineHeight: 32, letterSpacing: -0.3, color: color.ink },
  rowNote: { ...type.small, color: color.inkSoft, marginTop: 2 },
  bar: { padding: space.m, gap: space.s },
  note: { ...type.small, color: color.inkSoft, textAlign: 'center', paddingHorizontal: space.s, paddingBottom: space.xs },
});
