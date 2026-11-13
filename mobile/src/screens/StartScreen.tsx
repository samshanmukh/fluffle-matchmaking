import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Glass } from '../components/Glass';
import { PressableScale } from '../components/PressableScale';
import { LANGUAGES, MAX_LANGUAGES, TOPICS } from '../config';
import { estimateBeforeJoining, label, noticeCopy } from '../copy';
import { MAX_NAME } from '../identity';
import type { Link, StartView } from '../session/reducer';
import { useEstimate } from '../session/useEstimate';
import { color, font, radius, space, type } from '../theme';

interface Props {
  view: StartView;
  link: Link;
  name: string;
  languages: string[];
  topic: string | null;
  onLanguages: (next: string[]) => void;
  onTopic: (next: string | null) => void;
  onRename: (name: string) => void;
  onMatch: () => void;
  onDismissNotice: () => void;
}

const LINK_LINE: Record<Link, string> = {
  online: 'Ready when you are',
  connecting: 'Connecting',
  offline: "Can't reach Fluffle, retrying",
  replaced: 'Open on another device',
};

export function StartScreen(props: Props) {
  const { view, link, name, languages, topic } = props;
  const insets = useSafeAreaInsets();
  const [draftName, setDraftName] = useState(name);
  const [dockHeight, setDockHeight] = useState(190);
  const online = link === 'online';
  const { estimate, failed } = useEstimate(languages, online);
  const wait = estimateBeforeJoining(estimate, languages, failed || link === 'offline');
  const full = languages.length >= MAX_LANGUAGES;

  const toggleLanguage = (id: string) =>
    props.onLanguages(languages.includes(id) ? languages.filter((l) => l !== id) : [...languages, id]);

  const notice = view.notice ? noticeCopy(view.notice) : null;
  const blocked =
    link === 'replaced'
      ? 'Fluffle is open on another device with this name. Close it there to match from here.'
      : link === 'offline'
        ? "We can't reach Fluffle. We'll keep trying."
        : link === 'connecting'
          ? 'Connecting to Fluffle.'
          : null;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.m, paddingHorizontal: space.edge, paddingBottom: dockHeight + space.xl }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter} maxFontSizeMultiplier={1.2}>
              {(name.trim()[0] ?? '?').toUpperCase()}
            </Text>
          </View>
          <View style={styles.headerText}>
            <Text style={styles.hello} numberOfLines={1}>
              Hi, {name}
            </Text>
            <View style={styles.linkRow}>
              <View style={[styles.linkDot, { backgroundColor: online ? color.live : color.warn }]} />
              <Text style={styles.linkLine} numberOfLines={1}>
                {LINK_LINE[link]}
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.h1} accessibilityRole="header">
          Find someone{'\n'}to talk to
        </Text>

        {notice && (
          <PressableScale accessibilityRole="alert" accessibilityHint="Dismisses this message" onPress={props.onDismissNotice}>
            <Glass style={styles.notice} strong>
              <View style={styles.noticeBar} />
              <View style={styles.noticeText}>
                <Text style={styles.noticeTitle}>{notice.title}</Text>
                <Text style={styles.noticeBody}>{notice.body}</Text>
                <Text style={styles.noticeDismiss}>Tap to dismiss</Text>
              </View>
            </Glass>
          </PressableScale>
        )}

        <Glass style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.h2} accessibilityRole="header">
              Languages
            </Text>
            <Text style={styles.count}>
              {languages.length} of {MAX_LANGUAGES}
            </Text>
          </View>
          <View style={styles.chips}>
            {LANGUAGES.map((id) => {
              const selected = languages.includes(id);
              return <Chip key={id} label={label(id)} selected={selected} disabled={full && !selected} onPress={() => toggleLanguage(id)} />;
            })}
          </View>
          <Text style={styles.help}>
            {full
              ? 'Five is the most you can choose. Remove one to pick another.'
              : 'Pick the ones you can hold a conversation in. One in common is enough to be matched.'}
          </Text>
        </Glass>

        <Glass style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.h2} accessibilityRole="header">
              Topic
            </Text>
            <Text style={styles.count}>Optional</Text>
          </View>
          <View style={styles.chips}>
            {TOPICS.map((id) => (
              <Chip key={id} label={label(id)} selected={topic === id} onPress={() => props.onTopic(topic === id ? null : id)} />
            ))}
          </View>
          <Text style={styles.help}>
            We look for someone who picked the same topic first. If nobody has, you still get matched and can talk about anything.
          </Text>
        </Glass>

        <Glass style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.h2} accessibilityRole="header">
              Your name
            </Text>
          </View>
          <TextInput
            style={styles.input}
            value={draftName}
            onChangeText={setDraftName}
            onEndEditing={() => props.onRename(draftName)}
            maxLength={MAX_NAME}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="done"
            accessibilityLabel="Your name"
            placeholder="Your name"
            placeholderTextColor={color.inkFaint}
          />
          <Text style={styles.help}>Your match sees this when we ask if they're ready.</Text>
        </Glass>
      </ScrollView>

      <View
        style={[styles.dockWrap, { paddingBottom: Math.max(insets.bottom, space.m) }]}
        onLayout={(e) => setDockHeight(e.nativeEvent.layout.height)}
        pointerEvents="box-none"
      >
        <Glass round={radius.bar} strong style={styles.dock}>
          <View accessibilityLiveRegion="polite" style={styles.wait}>
            <Text style={styles.waitHeadline} numberOfLines={3}>
              {blocked ?? wait.headline}
            </Text>
            {!blocked && (
              <Text style={styles.waitDetail} numberOfLines={3}>
                {wait.detail}
              </Text>
            )}
          </View>
          <Button
            label={view.joining ? 'Joining' : 'Find a match'}
            onPress={props.onMatch}
            disabled={!online || languages.length === 0 || view.joining}
          />
        </Glass>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontFamily: font.medium, fontSize: 22, lineHeight: 28, color: '#FFFFFF' },
  headerText: { flex: 1 },
  hello: { fontFamily: font.medium, fontSize: 19, lineHeight: 24, color: color.ink },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkDot: { width: 8, height: 8, borderRadius: 4 },
  linkLine: { ...type.small, color: color.inkSoft, flexShrink: 1 },
  h1: { ...type.display, color: color.ink, marginTop: space.xl, marginBottom: space.s },
  notice: { marginTop: space.m, flexDirection: 'row' },
  noticeBar: { width: 6, backgroundColor: color.accent },
  noticeText: { flex: 1, padding: space.l },
  noticeTitle: { ...type.bodyStrong, color: color.ink },
  noticeBody: { ...type.small, color: color.ink, marginTop: 2 },
  noticeDismiss: { ...type.small, color: color.inkSoft, marginTop: space.s },
  card: { marginTop: space.m, padding: space.edge },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: space.m },
  h2: { ...type.title, color: color.ink, flexShrink: 1 },
  count: { ...type.small, color: color.inkSoft, fontVariant: ['tabular-nums'], marginLeft: space.m },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  help: { ...type.small, color: color.inkSoft, marginTop: space.m },
  input: { fontFamily: font.regular, fontSize: 17, minHeight: 52, borderRadius: 26, paddingHorizontal: space.edge, backgroundColor: color.solid, color: color.ink },
  dockWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.m },
  dock: { padding: space.m, gap: space.m },
  wait: { paddingHorizontal: space.m, paddingTop: space.s },
  waitHeadline: { ...type.bodyStrong, color: color.ink },
  waitDetail: { ...type.small, color: color.inkSoft, marginTop: 2 },
});
