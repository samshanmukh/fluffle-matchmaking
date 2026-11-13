import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Glass } from '../components/Glass';
import { Orb } from '../components/Orb';
import { StatusPill } from '../components/StatusPill';
import { clock, estimateWhileWaiting, label, list, minutes, requeueLine } from '../copy';
import type { WaitingView } from '../session/reducer';
import { color, font, radius, space, type } from '../theme';
import { useNow } from '../useNow';

interface Props {
  view: WaitingView;
  languages: string[];
  topic: string | null;
  onCancel: () => void;
}

export function WaitingScreen({ view, languages, topic, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const now = useNow(500);
  const estimate = estimateWhileWaiting(view.estimate);
  const left = view.budgetEndsAt - now;
  const elapsed = clock(now - view.since);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, space.m) }]}>
      <StatusPill label="Looking" />
      <View style={styles.top}>
        <Text style={styles.h1} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          Looking for someone
        </Text>
        <Text style={styles.sub} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6}>
          who speaks {list(languages, 'or')}
        </Text>
        {topic && <Text style={styles.topic}>Ideally to talk about {label(topic).toLowerCase()}</Text>}
      </View>

      <View style={styles.middle}>
        <Orb size={330} breathing>
          <Text style={styles.elapsed} accessibilityLabel={`Waiting for ${elapsed}`} maxFontSizeMultiplier={1.1}>
            {elapsed}
          </Text>
          <Text style={styles.elapsedLabel} maxFontSizeMultiplier={1.1}>
            so far
          </Text>
        </Orb>
      </View>

      <View style={styles.bottom}>
        {view.requeue && (
          <Glass strong style={styles.requeue}>
            <View style={styles.requeueBar} />
            <Text style={styles.requeueText} accessibilityRole="alert">
              {requeueLine(view.requeue.reason, view.requeue.partnerName)}
            </Text>
          </Glass>
        )}
        <Glass style={styles.estimate}>
          <View accessibilityLiveRegion="polite">
            <Text style={styles.estimateHeadline}>{estimate.headline}</Text>
            <Text style={styles.estimateDetail}>{estimate.detail}</Text>
            <Text style={styles.budget}>
              {left > 0
                ? `We'll keep looking for up to ${minutes(left)} more. If nobody fits by then, we'll stop and tell you.`
                : 'Finishing up this search.'}
            </Text>
          </View>
        </Glass>
        <Glass round={radius.bar} strong style={styles.bar}>
          <Button label={view.leaving ? 'Stopping' : 'Stop looking'} icon="close" variant="solid" onPress={onCancel} disabled={view.leaving} />
        </Glass>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.m },
  top: { alignItems: 'center', paddingHorizontal: space.s, marginTop: space.s },
  h1: { ...type.display, color: color.ink, textAlign: 'center' },
  sub: { fontFamily: font.regular, fontSize: 28, lineHeight: 34, color: color.inkSoft, textAlign: 'center' },
  topic: { ...type.small, color: color.inkSoft, textAlign: 'center', marginTop: space.s },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 160 },
  elapsed: { fontFamily: font.medium, fontSize: 46, lineHeight: 50, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  elapsedLabel: { fontFamily: font.regular, fontSize: 15, lineHeight: 19, color: 'rgba(255,255,255,0.9)' },
  bottom: { gap: space.s },
  requeue: { flexDirection: 'row' },
  requeueBar: { width: 6, backgroundColor: color.accent },
  requeueText: { ...type.small, color: color.ink, flex: 1, padding: space.l },
  estimate: { padding: space.edge },
  estimateHeadline: { ...type.title, color: color.ink },
  estimateDetail: { ...type.small, color: color.inkSoft, marginTop: 2 },
  budget: { ...type.small, color: color.inkSoft, marginTop: space.s },
  bar: { padding: space.m },
});
