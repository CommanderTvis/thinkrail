import {useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {View as MacView} from 'react-native-macos';
import {normalizeSessionTitle, SESSION_TITLE_MAX_LENGTH} from '../../../packages/contracts/src';
import {hostClient, type Session} from './HostClient';
import {Icon} from './Icon';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {tid} from './testId';

export function titleCommit(value: string): string | null {
  const title = normalizeSessionTitle(value);
  return title && title.length <= SESSION_TITLE_MAX_LENGTH ? title : null;
}

function HistoryRow({session, onOpen, onDismiss}: {session: Session; onOpen: () => void; onDismiss: () => void}) {
  const s = useThemeStyles(makeStyles);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const latest = useRef(session.title);
  const [hovered, setHovered] = useState(false);
  const finish = (save: boolean) => {
    const title = save ? titleCommit(latest.current) : null;
    if (title && title !== session.title) hostClient.renameSession(session.workspaceId, session.sessionId, title);
    setEditing(false);
  };
  return <View {...tid('closed-chat-row', {'session-id': session.sessionId})} style={[s.row, hovered && s.hovered]}>
    {editing ? <TextInput {...tid('closed-chat-name-input')} autoFocus value={draft} onChangeText={text => {latest.current = text; setDraft(text);}}
      onSubmitEditing={() => finish(true)} onBlur={() => finish(true)}
      {...{keyDownEvents: [{key: 'Escape'}], onKeyDown: (event: {nativeEvent: {key: string}; stopPropagation: () => void}) => {if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); finish(false);}}}} style={s.input} />
      : <Pressable {...tid('closed-chat-item', {'session-id': session.sessionId})} accessibilityRole="menuitem" onPress={onOpen}
        onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={s.item}>
        <Icon name="chat" color={color.muted} size={14} />
        <Text numberOfLines={1} style={s.title}>{session.title}</Text>
      </Pressable>}
    {!editing ? <>
      <Pressable {...tid('closed-chat-rename')} accessibilityRole="button" accessibilityLabel={`Rename ${session.title}`}
        onPress={() => {latest.current = session.title; setDraft(session.title); setEditing(true);}} style={s.action}>
        <Icon name="pencil" color={color.muted} size={13} />
      </Pressable>
      <Pressable {...tid('closed-chat-delete')} accessibilityRole="button" accessibilityLabel={`Move ${session.title} to trash`}
        onPress={() => {onDismiss(); hostClient.deleteSession(session.sessionId);}} style={s.action}>
        <Icon name="trash" color={color.muted} size={13} />
      </Pressable>
    </> : null}
  </View>;
}

export function ChatHistory({sessions, onOpen}: {sessions: Session[]; onOpen: (sessionId: string) => void}) {
  const s = useThemeStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const anchor = useRef<View>(null);
  if (!sessions.length) return null;
  return <View ref={anchor} collapsable={false}>
    <Pressable {...tid('chat-history', {open})} accessibilityRole="button" accessibilityLabel="Recently closed chats"
      onPress={() => setOpen(!open)} style={s.button}>
      <Icon name="list" color={color.muted} size={16} />
    </Pressable>
    {open ? <MacView {...tid('chat-history-popover')} accessibilityLabel="Recently closed" style={s.popover}
      keyDownEvents={[{key: 'Escape'}]} onKeyDown={event => {if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); setOpen(false);}}}>
      <ScrollView style={s.list}>
        {sessions.map(session => <HistoryRow key={session.sessionId} session={session}
          onOpen={() => {setOpen(false); onOpen(session.sessionId);}} onDismiss={() => setOpen(false)} />)}
      </ScrollView>
    </MacView> : null}
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  button: {width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderColor: palette.border},
  popover: {position: 'absolute', top: 32, right: 0, width: 300, padding: 4, zIndex: 20, borderWidth: 1, borderRadius: 6,
    borderColor: palette.borderStrong, backgroundColor: palette.elevated},
  list: {maxHeight: 360},
  row: {minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 4},
  hovered: {backgroundColor: palette.hover},
  item: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 6},
  title: {flex: 1, fontFamily: 'Geist Native Text', fontSize: 13, color: palette.text},
  action: {width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 4},
  input: {flex: 1, height: 26, paddingHorizontal: 6, borderWidth: 1, borderRadius: 4, borderColor: palette.border, color: palette.text,
    fontFamily: 'Geist Native Text', fontSize: 13},
});
