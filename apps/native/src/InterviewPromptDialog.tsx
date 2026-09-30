import {useRef, useState} from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {View as MacView} from 'react-native-macos';
import {hostClient} from './HostClient';
import {Icon} from './Icon';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {tid} from './testId';
import {toast} from './toast';

export const INTERVIEW_BOOKING_URL = 'https://calendar.app.google/5suMJdDEBFvYJ4zN9';
const INVITATION_COPY = 'Join us for a user interview, tell us about your experience with ThinkRail, and receive 100 bonus credits in Central (JetBrains AI).';

type Response = 'postpone' | 'never' | 'book';

export function InterviewPromptDialog() {
  const s = useThemeStyles(makeStyles);
  const [pending, setPending] = useState<Response | null>(null);
  const busy = useRef(false);
  const respond = (action: Response) => {
    if (busy.current) return;
    busy.current = true;
    setPending(action);
    hostClient.respondToInterview(action)
      .catch(error => toast.error(error instanceof Error ? error.message : String(error), "Couldn't save your response"))
      .finally(() => {busy.current = false; setPending(null);});
  };
  return <MacView style={s.layer} keyDownEvents={[{key: 'Escape'}]}
    onKeyDown={event => {if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); respond('postpone');}}}>
    <Pressable {...tid('dialog-overlay')} style={s.backdrop} onPress={() => respond('postpone')} />
    <View {...tid('interview-prompt-dialog')} accessibilityRole="alert" style={s.dialog}>
      <Pressable {...tid('interview-close')} accessibilityRole="button" accessibilityLabel="Close" onPress={() => respond('postpone')} style={s.close}>
        <Icon name="close" color={color.muted} size={16} />
      </Pressable>
      <Text style={s.title}>Help shape ThinkRail</Text>
      <Text style={s.body}>{INVITATION_COPY}</Text>
      <View style={s.footer}>
        <Pressable {...tid('interview-never')} accessibilityRole="button" disabled={pending !== null} onPress={() => respond('never')} style={s.ghost}>
          <Text style={s.label}>Never show again</Text>
        </Pressable>
        <View style={s.actions}>
          <Pressable {...tid('interview-postpone')} accessibilityRole="button" disabled={pending !== null} onPress={() => respond('postpone')} style={s.outline}>
            <Text style={s.label}>Not now</Text>
          </Pressable>
          <Pressable {...tid('interview-book', {href: INTERVIEW_BOOKING_URL})} accessibilityRole="link" disabled={pending !== null}
            onPress={() => {
              if (busy.current) return;
              Linking.openURL(INTERVIEW_BOOKING_URL).catch(() => {});
              respond('book');
            }} style={[s.primary, pending !== null && s.disabled]}>
            <Icon name="externalLink" color={color.onAccent} size={14} />
            <Text style={s.primaryLabel}>Schedule an interview</Text>
          </Pressable>
        </View>
      </View>
    </View>
  </MacView>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  layer: {...StyleSheet.absoluteFillObject, zIndex: 45, alignItems: 'center', justifyContent: 'center'},
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: '#00000088'},
  dialog: {width: 480, padding: 20, gap: 12, borderRadius: 8, borderWidth: 1, borderColor: palette.borderStrong, backgroundColor: palette.elevated},
  close: {position: 'absolute', top: 12, right: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 4},
  title: {fontFamily: 'Geist SemiBold', fontSize: 17, color: palette.text},
  body: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.muted},
  footer: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8},
  actions: {flexDirection: 'row', gap: 8},
  ghost: {paddingHorizontal: 12, paddingVertical: 7, borderRadius: 4},
  outline: {paddingHorizontal: 12, paddingVertical: 7, borderRadius: 4, borderWidth: 1, borderColor: palette.borderStrong},
  primary: {paddingHorizontal: 12, paddingVertical: 7, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.accentSolid},
  disabled: {opacity: 0.5},
  label: {fontFamily: 'Geist Native Text', fontSize: 13, color: palette.text},
  primaryLabel: {fontFamily: 'Geist Native Text', fontSize: 13, color: palette.onAccent},
});
