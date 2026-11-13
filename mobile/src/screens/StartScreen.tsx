import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { BottomTray } from '../components/BottomTray';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { PressableScale } from '../components/PressableScale';
import { Header, Sheet } from '../components/Sheet';
import { LANGUAGES, MAX_LANGUAGES, TOPICS } from '../config';
import { estimateBeforeJoining, label, noticeCopy, presenceLine } from '../copy';
import { MAX_NAME } from '../identity';
import { flag, languageFlag, regionName } from '../regions';
import type { Link, StartView } from '../session/reducer';
import { useEstimate } from '../session/useEstimate';
import { usePresence } from '../session/usePresence';
import { color, font, radius, space, type } from '../theme';
import { ANY_TOPIC_ICON, topicIcon } from '../topics';

interface Props {
  view: StartView;
  link: Link;
  /** Picks your avatar, so you see the same one your match will. */
  userId: string;
  name: string;
  region: string | null;
  languages: string[];
  topic: string | null;
  onLanguages: (next: string[]) => void;
  onTopic: (next: string | null) => void;
  onRename: (name: string) => void;
  onMatch: () => void;
  onDismissNotice: () => void;
}

/** The short status at the right of the header. */
const LINK_LABEL: Record<Link, string> = { online: 'Online', connecting: 'Connecting', offline: 'Offline', replaced: 'Elsewhere' };

const OFFLINE: Record<Exclude<Link, 'online'>, string> = {
  connecting: 'Connecting',
  offline: "Can't reach Fluffle, retrying",
  replaced: 'Open on another device',
};

export function StartScreen(props: Props) {
  const { view, link, name, region, languages, topic } = props;
  const [draftName, setDraftName] = useState(name);
  const [editingName, setEditingName] = useState(false);
  const online = link === 'online';
  const { estimate, failed } = useEstimate(languages, online);
  const presence = usePresence(languages, online);
  const full = languages.length >= MAX_LANGUAGES;
  const canMatch = online && languages.length > 0 && !view.joining;
  const wait = online ? estimateBeforeJoining(estimate, languages, failed) : OFFLINE[link];
  const notice = view.notice ? noticeCopy(view.notice) : null;

  const toggleLanguage = (id: string) =>
    props.onLanguages(languages.includes(id) ? languages.filter((l) => l !== id) : [...languages, id]);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header>
        <View style={styles.me}>
          <Avatar person={props.userId} size={42} />
          <View style={styles.meText}>
            {editingName ? (
              <TextInput
                style={styles.nameInput}
                value={draftName}
                onChangeText={setDraftName}
                onEndEditing={() => {
                  setEditingName(false);
                  props.onRename(draftName);
                }}
                autoFocus
                selectTextOnFocus
                maxLength={MAX_NAME}
                autoCorrect={false}
                autoCapitalize="words"
                returnKeyType="done"
                accessibilityLabel="Your name"
                placeholder="Your name"
                placeholderTextColor={color.inkFaint}
              />
            ) : (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Hi, ${name}. Change your name`}
                onPress={() => {
                  setDraftName(name);
                  setEditingName(true);
                }}
                hitSlop={10}
                style={styles.nameRow}
              >
                <Text style={styles.hello} numberOfLines={1}>
                  Hi, {name}
                </Text>
                <Ionicons name="pencil" size={13} color={color.onAccentSoft} />
              </PressableScale>
            )}
            {/* Detected from the phone, so it is a fact to read, not a control. */}
            <Text style={styles.region} numberOfLines={1} accessibilityLabel={`Connecting from ${regionName(region)}`}>
              {flag(region)} {regionName(region)}
            </Text>
          </View>
          <View style={styles.link} accessibilityRole="text" accessibilityLabel={LINK_LABEL[link]}>
            <View style={[styles.linkDot, { backgroundColor: online ? color.live : color.warn }]} />
            <Text style={styles.linkLabel}>{LINK_LABEL[link]}</Text>
          </View>
        </View>

        <Text style={styles.h1Lead}>Find someone</Text>
        <Text style={styles.h1} accessibilityRole="header">
          to talk to
        </Text>

        <View style={styles.hereHead} accessibilityLiveRegion="polite">
          <Text style={styles.hereLabel}>Here now</Text>
          <Text style={styles.hereCount}>{online && languages.length > 0 ? presenceLine(presence ? presence.waiting : null) : '—'}</Text>
        </View>
        {presence && presence.people.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.faces} style={styles.facesScroll}>
            {presence.people.map((p, i) => (
              <View key={`${p.avatar}-${i}`} style={styles.face}>
                <Avatar person={p.avatar} region={p.region} size={50} />
                <Text style={styles.faceLabel} numberOfLines={1}>
                  {regionName(p.region)}
                </Text>
              </View>
            ))}
          </ScrollView>
        )}
      </Header>

      <Sheet>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {notice && (
            <PressableScale accessibilityRole="alert" accessibilityHint="Dismisses this message" onPress={props.onDismissNotice}>
              <Card style={styles.notice}>
                <View style={styles.noticeBar} />
                <View style={styles.noticeText}>
                  <Text style={styles.noticeTitle}>{notice.title}</Text>
                  {notice.body !== '' && <Text style={styles.noticeBody}>{notice.body}</Text>}
                </View>
                <Ionicons name="close" size={16} color={color.inkFaint} style={styles.noticeClose} />
              </Card>
            </PressableScale>
          )}

          <View style={styles.sectionHead}>
            <Text style={styles.h2} accessibilityRole="header">
              I speak
            </Text>
            <Text style={styles.count}>{full ? `${languages.length} of ${MAX_LANGUAGES} · max` : `${languages.length} of ${MAX_LANGUAGES}`}</Text>
          </View>
          <View style={styles.chips}>
            {LANGUAGES.map((id) => {
              const selected = languages.includes(id);
              return <Chip key={id} label={label(id)} emoji={languageFlag(id)} selected={selected} disabled={full && !selected} onPress={() => toggleLanguage(id)} />;
            })}
          </View>

          <View style={styles.sectionHead}>
            <Text style={styles.h2} accessibilityRole="header">
              Topic
            </Text>
            <Text style={styles.count}>Optional</Text>
          </View>
          <View style={styles.chips} accessibilityRole="radiogroup">
            <Chip label="Anything" icon={ANY_TOPIC_ICON} role="radio" selected={topic === null} onPress={() => props.onTopic(null)} />
            {TOPICS.map((id) => (
              <Chip key={id} label={label(id)} icon={topicIcon(id)} role="radio" selected={topic === id} onPress={() => props.onTopic(topic === id ? null : id)} />
            ))}
          </View>
        </ScrollView>

        <BottomTray>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={view.joining ? 'Joining' : 'Find a match'}
            accessibilityState={{ disabled: !canMatch }}
            disabled={!canMatch}
            onPress={props.onMatch}
            style={[styles.cta, !canMatch && styles.ctaOff]}
          >
            <Text style={styles.ctaLabel} maxFontSizeMultiplier={1.3}>
              {view.joining ? 'Joining' : 'Find a match'}
            </Text>
            <Text style={styles.ctaSub} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {wait}
            </Text>
          </PressableScale>
        </BottomTray>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  me: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  meText: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 22 },
  hello: { ...font.medium, fontSize: 15, lineHeight: 20, color: color.onAccent, flexShrink: 1 },
  nameInput: { ...font.medium, fontSize: 15, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: color.solid, color: color.ink },
  region: { ...type.small, color: color.onAccentSoft },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.16)' },
  linkDot: { width: 8, height: 8, borderRadius: 4 },
  linkLabel: { ...font.medium, fontSize: 13, lineHeight: 18, color: color.onAccent },
  h1Lead: { ...font.regular, fontSize: 19, lineHeight: 24, color: color.onAccentSoft, marginTop: space.l },
  h1: { ...type.display, color: color.onAccent, textDecorationLine: 'underline' },
  hereHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.s, marginTop: space.l },
  hereLabel: { ...font.medium, fontSize: 15, lineHeight: 20, color: color.onAccent },
  hereCount: { ...font.regular, fontSize: 15, lineHeight: 20, color: color.onAccentSoft },
  facesScroll: { marginHorizontal: -space.xl, marginTop: space.m },
  faces: { paddingHorizontal: space.xl, gap: space.l },
  face: { alignItems: 'center', width: 62, gap: 6 },
  faceLabel: { ...type.small, color: color.onAccentSoft, maxWidth: 70 },
  scroll: { padding: space.edge, paddingBottom: space.xl },
  notice: { flexDirection: 'row', alignItems: 'center', marginBottom: space.s },
  noticeBar: { width: 5, alignSelf: 'stretch', backgroundColor: color.warn },
  noticeText: { flex: 1, paddingVertical: space.m, paddingHorizontal: space.m },
  noticeTitle: { ...type.bodyStrong, color: color.ink },
  noticeBody: { ...type.small, color: color.inkSoft },
  noticeClose: { marginRight: space.m },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: space.m, marginBottom: space.s },
  h2: { ...type.title, color: color.ink },
  count: { ...type.small, color: color.inkSoft, fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  cta: { minHeight: 56, borderRadius: radius.pill, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  ctaOff: { backgroundColor: color.off },
  ctaLabel: { ...font.medium, fontSize: 16, lineHeight: 21, color: color.onAccent },
  ctaSub: { ...font.regular, fontSize: 12, lineHeight: 16, color: color.onAccentSoft },
});
