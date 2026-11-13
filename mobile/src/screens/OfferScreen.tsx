import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Glass } from '../components/Glass';
import { Orb } from '../components/Orb';
import { PressableScale } from '../components/PressableScale';
import { StatusPill } from '../components/StatusPill';
import { label, list } from '../copy';
import type { OfferView } from '../session/reducer';
import { color, font, radius, space, type } from '../theme';
import { useNow } from '../useNow';

interface Props {
  view: OfferView;
  onReady: () => void;
  onDecline: (neverAgain: boolean) => void;
}

export function OfferScreen({ view, onReady, onDecline }: Props) {
  const insets = useSafeAreaInsets();
  const now = useNow(200);
  // Measured once, when the offer appears: the ring then drains on its own.
  const opened = useRef({ remaining: view.expiresAt - Date.now() }).current;
  const remaining = Math.max(0, view.expiresAt - now);
  const seconds = Math.ceil(remaining / 1000);
  const closed = remaining === 0;
  const name = view.partnerName;

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, space.m) }]}>
      <StatusPill label="Match found" tone="accent" />
      <View style={styles.top}>
        <Text style={styles.h1} accessibilityRole="header">
          You matched with
        </Text>
        <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>
          {name}
        </Text>
        <Text style={styles.detail}>
          You both speak {list(view.languages)}.{' '}
          {view.topic ? `You both picked ${label(view.topic).toLowerCase()}, so that's the topic.` : 'No shared topic, so talk about anything.'}
        </Text>
      </View>

      <View style={styles.middle}>
        <Orb
          size={310}
          countdown={{
            startFraction: Math.min(1, Math.max(0, opened.remaining / view.windowMs)),
            remainingMs: opened.remaining,
            frozen: view.answer !== null,
          }}
        >
          <Text style={styles.seconds} accessibilityRole="timer" accessibilityLabel={`${seconds} seconds left to answer`} maxFontSizeMultiplier={1.1}>
            {seconds}
          </Text>
          <Text style={styles.secondsLabel} maxFontSizeMultiplier={1.1}>
            {seconds === 1 ? 'second left' : 'seconds left'}
          </Text>
        </Orb>
      </View>

      <Glass round={radius.bar} strong style={styles.panel}>
        {view.answer === 'ready' ? (
          <View style={styles.state} accessibilityLiveRegion="polite">
            <Text style={styles.stateTitle}>{closed ? 'Time is up' : `You're ready. Waiting for ${name}.`}</Text>
            <Text style={styles.note}>
              The call starts only if {name} says ready too. If they pass or don't answer, you go back to the front of the queue.
            </Text>
          </View>
        ) : view.answer === 'decline' || closed ? (
          <View style={styles.state} accessibilityLiveRegion="polite">
            <Text style={styles.stateTitle}>{view.answer === 'decline' ? 'Passing on this match' : 'Time is up'}</Text>
            <Text style={styles.note}>Taking you back to the start.</Text>
          </View>
        ) : (
          <>
            <Button label="I'm ready to talk" icon="checkmark" variant="ink" onPress={onReady} />
            <Button label="Not this time" icon="close" variant="solid" onPress={() => onDecline(false)} />
            <PressableScale accessibilityRole="button" onPress={() => onDecline(true)} style={styles.textButton}>
              <Text style={styles.textButtonLabel} numberOfLines={2}>
                Don't match me with {name} again
              </Text>
            </PressableScale>
            <Text style={styles.note}>Passing or not answering takes you out of the queue. {name} keeps their place.</Text>
          </>
        )}
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.m },
  top: { alignItems: 'center', paddingHorizontal: space.s, marginTop: space.s },
  h1: { ...type.display, color: color.ink, textAlign: 'center' },
  name: { ...type.display, fontFamily: font.regular, color: color.inkSoft, textAlign: 'center' },
  detail: { ...type.body, color: color.ink, textAlign: 'center', marginTop: space.s },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 170 },
  seconds: { fontFamily: font.medium, fontSize: 64, lineHeight: 68, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  secondsLabel: { fontFamily: font.regular, fontSize: 15, lineHeight: 19, color: 'rgba(255,255,255,0.9)' },
  panel: { padding: space.m, gap: space.s },
  state: { padding: space.s, gap: space.s, minHeight: 150, justifyContent: 'center' },
  stateTitle: { ...type.title, color: color.ink },
  textButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.l },
  textButtonLabel: { ...type.bodyStrong, color: color.accentDeep, textAlign: 'center' },
  note: { ...type.small, color: color.inkSoft, paddingHorizontal: space.s, paddingBottom: space.xs },
});
