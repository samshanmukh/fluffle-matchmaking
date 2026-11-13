import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { BottomTray } from '../components/BottomTray';
import { Button } from '../components/Button';
import { Orb } from '../components/Orb';
import { PressableScale } from '../components/PressableScale';
import { RegionLink } from '../components/RegionLink';
import { Header, Sheet, StatusLine } from '../components/Sheet';
import { Tag } from '../components/Tag';
import { label } from '../copy';
import { languageFlag } from '../regions';
import type { OfferView } from '../session/reducer';
import { color, font, space, type } from '../theme';
import { topicIcon } from '../topics';
import { useNow } from '../useNow';
import { useTapGuard } from '../useTapGuard';

interface Props {
  view: OfferView;
  /** This user's own region, to show next to the partner's. */
  region: string | null;
  onReady: () => void;
  onDecline: (neverAgain: boolean) => void;
}

export function OfferScreen({ view, region, onReady, onDecline }: Props) {
  const now = useNow(200);
  const guard = useTapGuard();
  // Measured once, when the offer appears: the ring then drains on its own.
  const opened = useRef({ remaining: view.expiresAt - Date.now() }).current;
  const remaining = Math.max(0, view.expiresAt - now);
  const seconds = Math.ceil(remaining / 1000);
  const closed = remaining === 0;
  const name = view.partnerName;

  return (
    <View style={styles.root}>
      <Header style={styles.header}>
        <Text style={styles.lead}>Say hi to</Text>
        <Text style={styles.name} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>
          {name}
        </Text>
        <StatusLine label="Match found" />
        <View style={styles.regions}>
          <RegionLink mine={region} theirs={view.partnerRegion} />
        </View>
      </Header>

      <Sheet>
        <View style={styles.middle}>
          <Orb
            size={250}
            countdown={{
              startFraction: Math.min(1, Math.max(0, opened.remaining / view.windowMs)),
              remainingMs: opened.remaining,
              frozen: view.answer !== null,
            }}
          >
            <Avatar person={view.partnerId} size={104} />
          </Orb>
          <Text style={styles.countdown} accessibilityRole="timer" accessibilityLabel={`${seconds} seconds left to answer`} maxFontSizeMultiplier={1.2}>
            {closed ? 'Time is up' : `${seconds} ${seconds === 1 ? 'second' : 'seconds'} to answer`}
          </Text>
          <View style={styles.tags} accessibilityLabel={`You both speak ${view.languages.map(label).join(', ')}`}>
            {view.languages.map((id) => (
              <Tag key={id} label={label(id)} emoji={languageFlag(id)} />
            ))}
            <Tag icon={topicIcon(view.topic)} label={view.topic ? label(view.topic) : 'Any topic'} />
          </View>
        </View>

        <BottomTray>
          {view.answer === 'ready' ? (
            <View style={styles.state} accessibilityLiveRegion="polite">
              <Text style={styles.stateTitle}>{closed ? 'Time is up' : `You're in. Waiting for ${name}.`}</Text>
              <Text style={styles.note}>If they skip, you stay first in line.</Text>
            </View>
          ) : view.answer === 'decline' || closed ? (
            <View style={styles.state} accessibilityLiveRegion="polite">
              <Text style={styles.stateTitle}>{view.answer === 'decline' ? 'Skipping this match' : 'Time is up'}</Text>
            </View>
          ) : (
            <>
              <Button label="I'm ready" icon="checkmark" onPress={guard(onReady)} />
              <Button label="Not now" icon="close" variant="solid" onPress={guard(() => onDecline(false))} />
              <PressableScale accessibilityRole="button" accessibilityLabel="Don't match us again" onPress={guard(() => onDecline(true))} style={styles.textButton}>
                <Text style={styles.textButtonLabel}>Don't match us again</Text>
              </PressableScale>
              <Text style={styles.note}>Skipping or not answering takes you out of the queue.</Text>
            </>
          )}
        </BottomTray>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { alignItems: 'center' },
  lead: { ...font.regular, fontSize: 15, lineHeight: 20, color: color.onAccentSoft },
  name: { ...type.display, color: color.onAccent, textAlign: 'center' },
  regions: { marginTop: space.m, alignSelf: 'stretch' },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 190 },
  countdown: { ...type.title, color: color.ink, textAlign: 'center', marginTop: -space.l, fontVariant: ['tabular-nums'] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s, marginTop: space.m, paddingHorizontal: space.edge },
  state: { gap: 2, minHeight: 96, justifyContent: 'center', alignItems: 'center' },
  stateTitle: { ...type.title, color: color.ink, textAlign: 'center' },
  textButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { ...type.bodyStrong, color: color.danger },
  note: { ...type.small, color: color.inkSoft, textAlign: 'center' },
});
