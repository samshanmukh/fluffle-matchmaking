import { Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, useFonts } from '@expo-google-fonts/outfit';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { cleanName, loadIdentity, saveIdentity, type Identity } from './src/identity';
import { CallScreen } from './src/screens/CallScreen';
import { OfferScreen } from './src/screens/OfferScreen';
import { StartScreen } from './src/screens/StartScreen';
import { WaitingScreen } from './src/screens/WaitingScreen';
import { useMatchmaking } from './src/session/useMatchmaking';
import { EASE_OUT, color } from './src/theme';

// The four screens are phases of one server-driven session, not routes: the
// server moves the user between them, so there is no navigator to get out of
// step with it. The old phase is removed at once and the new one fades in, so
// two screens of text never overlap mid-fade.
const enter = FadeIn.duration(240).easing(EASE_OUT).reduceMotion(ReduceMotion.Never);

export default function App() {
  const [fontsReady] = useFonts({ Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold });
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [languages, setLanguages] = useState<string[]>(['english']);
  const [topic, setTopic] = useState<string | null>(null);
  const { state, join, cancel, respond, endCall, dismissNotice } = useMatchmaking(identity);
  const { view } = state;

  useEffect(() => {
    void loadIdentity().then(setIdentity);
  }, []);

  // One haptic per real event: a match arriving (you may not be looking at
  // the phone), and the call starting. Never the only signal.
  const previous = useRef(view.kind);
  useEffect(() => {
    if (previous.current === view.kind) return;
    previous.current = view.kind;
    if (view.kind === 'offer') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    if (view.kind === 'call') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [view.kind]);

  const rename = (input: string) => {
    if (!identity) return;
    const name = cleanName(input, identity.name);
    if (name === identity.name) return;
    const next = { ...identity, name };
    setIdentity(next);
    void saveIdentity(next);
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.root}>
        {identity && fontsReady && (
          <Animated.View key={view.kind} entering={enter} style={StyleSheet.absoluteFill}>
            {view.kind === 'start' && (
              <StartScreen
                view={view}
                link={state.link}
                userId={identity.id}
                name={identity.name}
                region={identity.region}
                languages={languages}
                topic={topic}
                onLanguages={setLanguages}
                onTopic={setTopic}
                onRename={rename}
                onMatch={() => join(languages, topic)}
                onDismissNotice={dismissNotice}
              />
            )}
            {view.kind === 'waiting' && <WaitingScreen view={view} userId={identity.id} languages={languages} topic={topic} onCancel={cancel} />}
            {view.kind === 'offer' && (
              <OfferScreen
                key={view.matchId}
                view={view}
                region={identity.region}
                onReady={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  respond(view.matchId, 'ready');
                }}
                onDecline={(neverAgain) => respond(view.matchId, 'decline', neverAgain)}
              />
            )}
            {view.kind === 'call' && <CallScreen view={view} region={identity.region} onEnd={endCall} />}
          </Animated.View>
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  // Purple behind everything: each screen's header sits on it, and its sheet covers the rest.
  root: { flex: 1, backgroundColor: color.accent },
});
