import {useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {View as MacView} from 'react-native-macos';
import {resourceGroups, resourcesLabel, type BackgroundCommand, type CommandOutput, type SessionResources, type SubagentResource} from './resourceGroups';
import {ConfirmDialog} from './ConfirmDialog';
import {hostClient, useHostClient, type ChatMessage} from './HostClient';
import {Icon} from './Icon';
import {chatMessageText} from './messageActionModel';
import {tid} from './testId';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';

type Action = {pending: boolean; error: string};

export function useChatResources(workspaceId: string, sessionId: string) {
  const {connection, resourcesRevision} = useHostClient();
  const [snapshot, setSnapshot] = useState<SessionResources | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [actions, setActions] = useState<Record<string, Action>>({});
  useEffect(() => {
    if (connection !== 'connected' || !sessionId) return;
    let current = true;
    hostClient.sessionResources(workspaceId, sessionId)
      .then(next => {if (current) {setSnapshot(next); setError('');}})
      .catch(reason => {if (current) setError(String(reason));});
    return () => {current = false;};
  }, [connection, workspaceId, sessionId, resourcesRevision, attempt]);
  const resources = snapshot?.sessionId === sessionId ? snapshot : null;
  const authoritative = connection === 'connected' && resources !== null && !error;
  const groups = resourceGroups(resources);
  const run = async (key: string, request: () => Promise<unknown>) => {
    if (actions[key]?.pending) return;
    setActions(current => ({...current, [key]: {pending: true, error: ''}}));
    let failure = '';
    try {await request();} catch (reason) {failure = String(reason);}
    setActions(current => ({...current, [key]: {pending: false, error: failure}}));
  };
  return {
    ...groups, workspaceId, sessionId, authoritative, error, actions,
    loading: resources === null && !error, stale: resources !== null && !authoritative,
    activeCount: authoritative ? groups.commands.length + groups.subagents.length : null,
    retry: () => setAttempt(current => current + 1),
    stopCommand: (id: string) => run(`command:${id}`, () => hostClient.stopBackgroundCommand(workspaceId, sessionId, id)),
    stopSubagent: (id: string) => run(`subagent:${id}`, () => hostClient.stopSubagent(workspaceId, sessionId, id)),
    stopAll: () => run('all', () => hostClient.stopAllSubagents(workspaceId, sessionId)),
  };
}

type Resources = ReturnType<typeof useChatResources>;

export function ResourcesButton({activeCount, open, onPress}: {activeCount: number | null; open: boolean; onPress: () => void}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <Pressable {...tid('resources-trigger', {'active-count': activeCount ?? 'unknown', open})} {...{enableFocusRing: true}} accessibilityRole="button"
    accessibilityLabel={resourcesLabel(activeCount)} accessibilityState={{expanded: open}} onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[s.trigger, (hovered || open) && s.hovered]}>
    <Icon name="stack" size={14} color={open ? color.text : color.muted} />
    <Text style={s.metadata}>Resources</Text><Text style={s.metadata}>{activeCount ?? '—'}</Text>
  </Pressable>;
}

function TextAction({testId, label, disabled = false, onPress}: {testId: string; label: string; disabled?: boolean; onPress: () => void}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <Pressable {...tid(testId, {disabled})} accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[s.action, hovered && s.hovered, disabled && s.disabled]}>
    <Text style={s.actionLabel}>{label}</Text>
  </Pressable>;
}

function Stop({action, disabled, onStop}: {action?: Action; disabled: boolean; onStop: () => void}) {
  return <TextAction testId="resource-stop" label={action?.pending ? 'Stopping…' : 'Stop'} disabled={disabled || !!action?.pending} onPress={onStop} />;
}

function CommandRow({command, active, resources, onLogs}: {command: BackgroundCommand; active: boolean; resources: Resources; onLogs: () => void}) {
  const s = useStyles();
  const action = resources.actions[`command:${command.id}`];
  return <View {...tid('resource-command', {'resource-id': command.id, status: command.status})} style={s.row}>
    <View style={s.rowHead}><Icon name="terminal" size={14} color={color.muted} />
      <Text numberOfLines={1} style={[s.ui, s.fill]}>{command.name}</Text><Text style={s.metadata}>{command.status}</Text></View>
    <Text numberOfLines={1} style={s.code}>{command.command}</Text>
    <View style={s.rowActions}><TextAction testId="resource-logs" label="Logs" onPress={onLogs} />
      {active ? <Stop action={action} disabled={!resources.authoritative || command.status === 'stopping'} onStop={() => resources.stopCommand(command.id)} /> : null}
      {command.exitCode !== undefined && command.exitCode !== null ? <Text style={s.metadata}>Exit {command.exitCode}</Text> : null}</View>
    {command.errorMessage ? <Text accessibilityRole="alert" style={s.error}>{command.errorMessage}</Text> : null}
    {action?.error ? <Text accessibilityRole="alert" style={s.error}>{action.error}</Text> : null}
  </View>;
}

function SubagentRow({child, active, resources, onTranscript}: {child: SubagentResource; active: boolean; resources: Resources; onTranscript: () => void}) {
  const s = useStyles();
  const action = resources.actions[`subagent:${child.childSessionId}`];
  return <View {...tid('resource-subagent', {'resource-id': child.childSessionId, status: child.status})} style={s.row}>
    <View style={s.rowHead}><Icon name="robot" size={14} color={color.muted} />
      <Text numberOfLines={1} style={[s.ui, s.fill]}>{child.roleName ?? 'Subagent'}</Text><Text style={s.metadata}>{child.status}</Text></View>
    <Text numberOfLines={2} style={s.metadata}>{child.task}</Text>
    <View style={s.rowActions}><TextAction testId="resource-transcript" label="Transcript" onPress={onTranscript} />
      {active ? <Stop action={action} disabled={!resources.authoritative || !!resources.actions.all?.pending} onStop={() => resources.stopSubagent(child.childSessionId)} /> : null}</View>
    {child.abortReason ? <Text style={s.metadata}>{child.abortReason}</Text> : null}
    {action?.error ? <Text accessibilityRole="alert" style={s.error}>{action.error}</Text> : null}
  </View>;
}

function Detail({testId, title, onClose, children}: {testId: string; title: string; onClose: () => void; children: React.ReactNode}) {
  const s = useStyles();
  return <MacView style={s.layer} keyDownEvents={[{key: 'Escape'}]} onKeyDown={event => {
    if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); onClose();}
  }}>
    <Pressable style={s.backdrop} onPress={onClose} />
    <View {...tid(testId)} style={s.detail}>
      <View style={s.rowHead}><Text numberOfLines={1} style={[s.ui, s.fill]} {...{tooltip: title}}>{title}</Text>
        <TextAction testId="resource-detail-close" label="Close" onPress={onClose} /></View>
      {children}
    </View>
  </MacView>;
}

function CommandLog({resources, command, onClose}: {resources: Resources; command: BackgroundCommand; onClose: () => void}) {
  const s = useStyles();
  const {resourcesRevision} = useHostClient();
  const [result, setResult] = useState<CommandOutput | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const {workspaceId, sessionId} = resources;
  useEffect(() => {
    let current = true;
    hostClient.backgroundCommandOutput(workspaceId, sessionId, command.id)
      .then(next => {if (current) {setResult(next); setError('');}})
      .catch(reason => {if (current) setError(String(reason));});
    return () => {current = false;};
  }, [workspaceId, sessionId, command.id, resourcesRevision, attempt]);
  return <Detail testId="command-log-dialog" title={command.name} onClose={onClose}>
    {resources.stale ? <Text style={s.warning}>Logs are stale. Reconnecting…</Text> : null}
    {error ? <View style={s.rowActions}><Text accessibilityRole="alert" style={[s.error, s.fill]}>{error}</Text>
      <TextAction testId="resources-retry" label="Retry" disabled={resources.stale} onPress={() => setAttempt(current => current + 1)} /></View> : null}
    {result === null ? (error ? null : <Text style={s.metadata}>Loading logs…</Text>)
      : !result.available ? <Text {...tid('command-log-unavailable')} style={s.ui}>Logs are no longer available. Command output is retained only for recent work on this host.</Text>
      : <>
        <Text style={s.metadata}>{result.command.status}{result.command.exitCode !== undefined && result.command.exitCode !== null ? ` · Exit ${result.command.exitCode}` : ''}</Text>
        {result.output.truncated ? <Text style={s.warning}>Output truncated — showing the retained tail.</Text> : null}
        {!result.output.text ? <Text style={s.metadata}>No output yet.</Text> : null}
        <ScrollView style={s.output}><Text {...tid('command-log-output')} selectable style={s.outputText}>{result.output.text}</Text></ScrollView>
      </>}
  </Detail>;
}

function SubagentTranscript({resources, childSessionId, onClose}: {resources: Resources; childSessionId: string; onClose: () => void}) {
  const s = useStyles();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState('');
  const {workspaceId, sessionId} = resources;
  useEffect(() => {
    let current = true;
    hostClient.subagentTranscript(workspaceId, sessionId, childSessionId)
      .then(result => {if (current) setMessages(result.messages);})
      .catch(reason => {if (current) setError(String(reason));});
    return () => {current = false;};
  }, [workspaceId, sessionId, childSessionId]);
  return <Detail testId="subagent-transcript-dialog" title="Subagent transcript" onClose={onClose}>
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    {messages === null ? (error ? null : <Text style={s.metadata}>Loading transcript…</Text>)
      : <ScrollView style={s.output}>{messages.map((message, index) => <View key={index} style={s.transcriptRow}>
        <Text style={s.metadata}>{message.role}</Text><Text selectable style={s.ui}>{chatMessageText(message)}</Text></View>)}
        {!messages.length ? <Text style={s.metadata}>No messages yet.</Text> : null}</ScrollView>}
  </Detail>;
}

type DetailTarget = {kind: 'log'; command: BackgroundCommand} | {kind: 'transcript'; childSessionId: string} | {kind: 'stop-all'};

export function ResourcesLayer({resources, open, onClose}: {resources: Resources; open: boolean; onClose: () => void}) {
  const s = useStyles();
  const [finishedOpen, setFinishedOpen] = useState(false);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const show = (next: DetailTarget) => {onClose(); setDetail(next);};
  const finished = resources.finishedCommands.length + resources.finishedSubagents.length;
  const quiet = !resources.loading && !resources.stale;
  const command = (item: BackgroundCommand, active: boolean) => <CommandRow key={item.id} command={item} active={active} resources={resources} onLogs={() => show({kind: 'log', command: item})} />;
  const subagent = (item: SubagentResource, active: boolean) => <SubagentRow key={item.childSessionId} child={item} active={active} resources={resources}
    onTranscript={() => show({kind: 'transcript', childSessionId: item.childSessionId})} />;
  return <>
    {open ? <MacView style={s.layer} keyDownEvents={[{key: 'Escape'}]} onKeyDown={event => {
      if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); onClose();}
    }}>
      <Pressable style={s.clear} onPress={onClose} />
      <ScrollView {...tid('resources-popover')} accessibilityLabel="Resources" style={s.popover} contentContainerStyle={s.popoverContent}>
        <Text style={s.ui}>Resources</Text>
        {resources.loading ? <Text style={s.metadata}>Loading resources…</Text> : null}
        {resources.stale ? <Text style={s.warning}>Resources are stale. Controls are disabled until refreshed.</Text> : null}
        {resources.error ? <View style={s.rowActions}><Text accessibilityRole="alert" style={[s.error, s.fill]}>{resources.error}</Text>
          <TextAction testId="resources-retry" label="Retry" onPress={resources.retry} /></View> : null}
        <View {...tid('resources-commands')} accessibilityLabel="Commands">
          <Text style={s.metadata}>Commands · {resources.commands.length}</Text>
          {resources.commands.map(item => command(item, true))}
          {quiet && !resources.commands.length ? <Text style={s.empty}>No active commands.</Text> : null}
        </View>
        <View {...tid('resources-subagents')} accessibilityLabel="Subagents">
          <View style={s.rowHead}><Text style={[s.metadata, s.fill]}>Subagents · {resources.subagents.length}</Text>
            {resources.subagents.length ? <TextAction testId="resources-stop-all" label={resources.actions.all?.pending ? 'Stopping…' : 'Stop all subagents'}
              disabled={!resources.authoritative || !!resources.actions.all?.pending || resources.subagents.some(child => resources.actions[`subagent:${child.childSessionId}`]?.pending)}
              onPress={() => show({kind: 'stop-all'})} /> : null}</View>
          {resources.actions.all?.error ? <Text accessibilityRole="alert" style={s.error}>{resources.actions.all.error}</Text> : null}
          {resources.subagents.map(item => subagent(item, true))}
          {quiet && !resources.subagents.length ? <Text style={s.empty}>No active subagents.</Text> : null}
        </View>
        <View style={s.finished}>
          <Pressable {...tid('resources-finished-toggle', {expanded: finishedOpen})} accessibilityRole="button" accessibilityState={{expanded: finishedOpen}}
            onPress={() => setFinishedOpen(!finishedOpen)} style={s.rowActions}>
            <Icon name={finishedOpen ? 'arrowDown' : 'arrowRight'} size={16} color={color.muted} /><Text style={s.actionLabel}>Finished · {finished}</Text>
          </Pressable>
          {finishedOpen ? <>
            {resources.finishedCommands.map(item => command(item, false))}
            {resources.finishedSubagents.map(item => subagent(item, false))}
            {!finished ? <Text style={s.empty}>No finished resources.</Text> : null}
          </> : null}
        </View>
      </ScrollView>
    </MacView> : null}
    {detail?.kind === 'log' ? <CommandLog resources={resources} command={detail.command} onClose={() => setDetail(null)} /> : null}
    {detail?.kind === 'transcript' ? <SubagentTranscript resources={resources} childSessionId={detail.childSessionId} onClose={() => setDetail(null)} /> : null}
    {detail?.kind === 'stop-all' ? <ConfirmDialog title="Stop all subagents?" confirmLabel="Stop all" confirmTestId="resources-stop-all-confirm"
      description={`This stops ${resources.subagents.length} active subagent${resources.subagents.length === 1 ? '' : 's'} of this chat. The main chat keeps running and can delegate again.`}
      onCancel={() => setDetail(null)} onConfirm={() => {setDetail(null); resources.stopAll();}} /> : null}
  </>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  trigger: {height: 22, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, borderRadius: 4},
  hovered: {backgroundColor: palette.hover}, disabled: {opacity: 0.45}, fill: {flex: 1, minWidth: 0},
  ui: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 14, lineHeight: 20},
  metadata: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12, lineHeight: 16},
  code: {fontFamily: 'JetBrains Mono', color: palette.muted, fontSize: 11, lineHeight: 16},
  warning: {fontFamily: 'Geist Native Text', color: palette.warning, fontSize: 12, lineHeight: 16},
  error: {fontFamily: 'Geist Native Text', color: palette.red, fontSize: 12, lineHeight: 16},
  empty: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12, lineHeight: 16, paddingVertical: 8},
  layer: {...StyleSheet.absoluteFillObject, zIndex: 30}, clear: {...StyleSheet.absoluteFillObject},
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: '#00000088'},
  popover: {position: 'absolute', top: 30, right: 8, width: 360, maxWidth: '92%', maxHeight: '80%', borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 6, backgroundColor: palette.elevated},
  popoverContent: {padding: 12, gap: 12},
  row: {gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderColor: palette.border},
  rowHead: {flexDirection: 'row', alignItems: 'center', gap: 4}, rowActions: {flexDirection: 'row', alignItems: 'center', gap: 4},
  action: {paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4}, actionLabel: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 12, lineHeight: 16},
  finished: {paddingTop: 8, borderTopWidth: 1, borderColor: palette.border},
  detail: {position: 'absolute', top: '10%', left: '10%', right: '10%', maxHeight: '80%', padding: 12, gap: 8, borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 8, backgroundColor: palette.elevated},
  output: {flexShrink: 1, borderRadius: 4, backgroundColor: palette.content, padding: 12},
  outputText: {fontFamily: 'JetBrains Mono', color: palette.text, fontSize: 12, lineHeight: 18},
  transcriptRow: {gap: 2, paddingBottom: 8},
});

const useStyles = () => useThemeStyles(makeStyles);
