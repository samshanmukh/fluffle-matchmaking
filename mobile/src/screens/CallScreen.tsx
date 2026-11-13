import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { BottomTray } from '../components/BottomTray';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Orb } from '../components/Orb';
import { PressableScale } from '../components/PressableScale';
import { RegionLink } from '../components/RegionLink';
import { Header, Sheet, StatusLine } from '../components/Sheet';
import { Tag } from '../components/Tag';
import { clock, label } from '../copy';
import { languageFlag } from '../regions';
import type { CallView } from '../session/reducer';
import { color, space, type } from '../theme';
import { starter, topicIcon } from '../topics';
import { useNow } from '../useNow';
import { useTapGuard } from '../useTapGuard';

interface Props {
  view: CallView;
  region: string | null;
  onEnd: () => void;
}

export function CallScreen({ view, region, onEnd }: Props) {
  const now = useNow(500);
  const guard = useTapGuard();
  const [step, setStep] = useState(0);
  return (
    <View style={styles.root}>
      <Header style={styles.header}>
        <Text style={styles.name} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>
          {view.partnerName}
        </Text>
        <StatusLine label={`On a call · ${clock(now - view.startedAt)}`} />
        <View style={styles.regions}>
          <RegionLink mine={region} theirs={view.partnerRegion} />
        </View>
      </Header>

      <Sheet>
        <View style={styles.middle}>
          <Orb size={230} breathing>
            <Avatar person={view.partnerId} size={98} />
          </Orb>
          <View style={styles.tags} accessibilityLabel={`Speaking ${view.languages.map(label).join(', ')}`}>
            {view.languages.map((id) => (
              <Tag key={id} label={label(id)} emoji={languageFlag(id)} />
            ))}
            <Tag icon={topicIcon(view.topic)} label={view.topic ? label(view.topic) : 'No set topic'} />
          </View>
        </View>

        <Card style={styles.card}>
          <Text style={styles.starterLabel}>Try asking</Text>
          <Text style={styles.starter} accessibilityLiveRegion="polite">
            {starter(view.topic, view.matchId, step)}
          </Text>
          <PressableScale accessibilityRole="button" onPress={() => setStep((n) => n + 1)} style={styles.another} hitSlop={8}>
            <Text style={styles.anotherLabel}>Another idea</Text>
          </PressableScale>
        </Card>

        <BottomTray>
          <Button label="End call" icon="call" variant="danger" onPress={guard(onEnd)} />
          <Text style={styles.note}>Prototype: no audio.</Text>
        </BottomTray>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { alignItems: 'center' },
  name: { ...type.display, color: color.onAccent, textAlign: 'center' },
  regions: { marginTop: space.m, alignSelf: 'stretch' },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 170 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s, marginTop: -space.m, paddingHorizontal: space.edge },
  card: { marginHorizontal: space.edge, marginBottom: space.l, padding: space.l },
  starterLabel: { ...type.small, color: color.inkSoft },
  starter: { ...type.title, color: color.ink, marginTop: 2 },
  another: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center', marginTop: space.xs },
  anotherLabel: { ...type.bodyStrong, color: color.accent },
  note: { ...type.small, color: color.inkSoft, textAlign: 'center' },
});
