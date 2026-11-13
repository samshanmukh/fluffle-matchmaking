import { StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { BottomTray } from '../components/BottomTray';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Orb } from '../components/Orb';
import { Header, Sheet, StatusLine } from '../components/Sheet';
import { Tag } from '../components/Tag';
import { budgetLine, clock, estimateLine, label, list, requeueLine } from '../copy';
import type { WaitingView } from '../session/reducer';
import { color, font, space, type } from '../theme';
import { topicIcon } from '../topics';
import { useNow } from '../useNow';
import { useTapGuard } from '../useTapGuard';

interface Props {
  view: WaitingView;
  /** This user's own id: while nobody is matched yet, the orb shows their own avatar. */
  userId: string;
  languages: string[];
  topic: string | null;
  onCancel: () => void;
}

export function WaitingScreen({ view, userId, languages, topic, onCancel }: Props) {
  const now = useNow(500);
  const guard = useTapGuard();
  const elapsed = clock(now - view.since);

  return (
    <View style={styles.root}>
      <Header style={styles.header}>
        <Text style={styles.h1} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          Finding you someone
        </Text>
        <StatusLine label={`Looking · speaks ${list(languages, 'or')}`} />
      </Header>

      <Sheet>
        <View style={styles.middle}>
          <Orb size={250} breathing>
            <Avatar person={userId} size={104} />
          </Orb>
          <Text style={styles.elapsed} accessibilityLabel={`Waiting for ${elapsed}`} maxFontSizeMultiplier={1.1}>
            {elapsed}
          </Text>
          <View style={styles.tags}>
            <Tag icon={topicIcon(topic)} label={topic ? label(topic) : 'Any topic'} />
          </View>
        </View>

        <View style={styles.info}>
          {view.requeue && (
            <Card style={styles.requeue}>
              <View style={styles.requeueBar} />
              <Text style={styles.requeueText} accessibilityRole="alert">
                {requeueLine(view.requeue.reason, view.requeue.partnerName)}
              </Text>
            </Card>
          )}
          <View accessibilityLiveRegion="polite">
            <Text style={styles.estimate}>{estimateLine(view.estimate, { waiting: true })}</Text>
            <Text style={styles.budget}>{budgetLine(view.budgetEndsAt - now)}</Text>
          </View>
        </View>

        <BottomTray>
          <Button label={view.leaving ? 'Stopping' : 'Stop looking'} icon="close" variant="solid" onPress={guard(onCancel)} disabled={view.leaving} />
        </BottomTray>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { alignItems: 'center', gap: 2 },
  h1: { ...font.medium, fontSize: 19, lineHeight: 24, color: color.onAccent },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 200 },
  // Stretched and centred: Android measures a shrink-wrapped custom-font label too narrow and drops its last character.
  elapsed: { ...font.medium, fontSize: 40, lineHeight: 44, color: color.ink, marginTop: -space.xl, fontVariant: ['tabular-nums'], textAlign: 'center', alignSelf: 'stretch' },
  tags: { flexDirection: 'row', justifyContent: 'center', marginTop: space.s },
  info: { paddingHorizontal: space.edge, paddingBottom: space.l, gap: space.m },
  requeue: { flexDirection: 'row', alignItems: 'center' },
  requeueBar: { width: 5, alignSelf: 'stretch', backgroundColor: color.warn },
  requeueText: { ...type.small, color: color.ink, flex: 1, padding: space.m },
  estimate: { ...type.title, color: color.ink, textAlign: 'center' },
  budget: { ...type.small, color: color.inkSoft, textAlign: 'center' },
});
