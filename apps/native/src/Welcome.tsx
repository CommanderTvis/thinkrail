import {useEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {hostClient, useHostClient} from './HostClient';
import {Icon, type IconName} from './Icon';
import {PrimaryButton} from './PrimaryButton';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {tid} from './testId';

export const SETUP_PROMPT = '/skill:setting-up-a-project ';
export const SETUP_NOTE = "Runs the setting-up-a-project skill — the agent drafts your project's specs, starting from its goal, before building.";

function Card({title, subtitle, icon, cta, primary, tag, onPress}: {
  title: string; subtitle: string; icon: IconName; cta?: boolean; primary?: boolean; tag?: string; onPress: (x: number, y: number) => void;
}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  const ref = useRef<View>(null);
  return <Pressable ref={ref} {...tid(cta ? 'welcome-cta' : 'welcome-action')} accessibilityRole="button"
    onPress={() => ref.current?.measureInWindow((x, y, _width, height) => onPress(x, y + height + 4))}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[s.card, primary ? s.cardPrimary : s.cardPlain, hovered && (primary ? s.cardPrimaryHovered : s.cardPlainHovered)]}>
    {tag ? <Text style={s.tag}>{tag}</Text> : null}
    <Icon name={icon} color={primary ? color.accent : color.muted} size={24} />
    <View>
      <Text style={s.cardTitle}>{title}</Text>
      <Text style={s.cardSubtitle}>{subtitle}</Text>
    </View>
  </Pressable>;
}

function ProviderWarning({settingsOpen, onConnect}: {settingsOpen: boolean; onConnect: () => void}) {
  const s = useStyles();
  const [hasProvider, setHasProvider] = useState<boolean | null>(null);
  useEffect(() => {
    if (settingsOpen) return;
    let current = true;
    hostClient.providerStatus()
      .then(report => {if (current) setHasProvider(report.providers.some(provider => provider.configured));})
      .catch(() => {if (current) setHasProvider(true);});
    return () => {current = false;};
  }, [settingsOpen]);
  if (hasProvider !== false) return null;
  return <View {...tid('welcome-provider-warning')} style={s.warning}>
    <Icon name="alertWarning" color={color.warning} size={16} />
    <Text style={s.warningText}>No model provider connected — the agent can't run.</Text>
    <PrimaryButton {...tid('welcome-connect-provider')} label="Connect a provider" onPress={onConnect} />
  </View>;
}

export function Welcome({settingsOpen, onOpenProjectMenu, onConnectProvider, onNewWorkspace}: {
  settingsOpen: boolean;
  onOpenProjectMenu: (anchor: {x: number; y: number}) => void;
  onConnectProvider: () => void;
  onNewWorkspace: (projectId: string, prompt: string, note?: string) => void;
}) {
  const s = useStyles();
  const state = useHostClient();
  const project = state.projects.find(item => item.id === state.projectId) ?? state.projects[0];
  const [hasSpecs, setHasSpecs] = useState<boolean | null>(null);
  const projectId = project?.id;
  useEffect(() => {
    setHasSpecs(null);
    if (!projectId) return;
    let current = true;
    hostClient.projectHasSpecs(projectId)
      .then(result => {if (current) setHasSpecs(result.hasSpecs);})
      .catch(() => {if (current) setHasSpecs(true);});
    return () => {current = false;};
  }, [projectId]);
  const projectFolder = (id: string) => <Card icon="home" title="Work in project folder"
    subtitle="Chats, changes, and terminals run directly in your project folder — no isolation."
    onPress={() => {hostClient.enterDefaultWorkspace(id).catch(() => {});}} />;
  return <View {...tid('welcome')} style={s.root}>
    <View {...tid('welcome-title')}><Text style={s.title}>{project ? project.name : 'ThinkRail'}</Text></View>
    <ProviderWarning settingsOpen={settingsOpen} onConnect={onConnectProvider} />
    <View style={s.cards}>
      {!project ? <Card cta primary icon="folderOpen" title="Open project" subtitle="Choose a local git repository to work in."
        onPress={(x, y) => onOpenProjectMenu({x, y})} />
        : hasSpecs === null ? <><View style={[s.card, s.cardPlain]} /><View style={[s.card, s.cardPlain]} /></>
        : hasSpecs ? <>
          <Card cta primary icon="play" title="Start building" subtitle="Cut an isolated worktree + branch, then pair with the agent to build it."
            onPress={() => onNewWorkspace(project.id, '')} />
          {projectFolder(project.id)}
        </> : <>
          <Card cta primary icon="sparkle" title="Set up project" tag="spec-first"
            subtitle="Draft the project's specs with the agent before building, starting from its goal."
            onPress={() => onNewWorkspace(project.id, SETUP_PROMPT, SETUP_NOTE)} />
          <Card icon="play" title="Start building" subtitle="Cut an isolated worktree + branch and pair with the agent."
            onPress={() => onNewWorkspace(project.id, '')} />
          {projectFolder(project.id)}
        </>}
    </View>
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  root: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: palette.content},
  title: {fontFamily: 'Geist SemiBold', fontSize: 40, color: palette.accent, textAlign: 'center', maxWidth: 640},
  cards: {marginTop: 24, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12},
  card: {width: 220, height: 150, padding: 16, borderWidth: 1, borderRadius: 4, justifyContent: 'space-between'},
  cardPrimary: {borderColor: palette.primaryMuted, backgroundColor: palette.primarySubtle},
  cardPrimaryHovered: {backgroundColor: `${palette.accent}33`},
  cardPlain: {borderColor: palette.border, backgroundColor: palette.bg},
  cardPlainHovered: {borderColor: palette.primaryMuted, backgroundColor: palette.elevated},
  cardTitle: {fontFamily: 'Geist SemiBold', fontSize: 14, color: palette.text},
  cardSubtitle: {marginTop: 2, fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.muted},
  tag: {position: 'absolute', top: 12, right: 12, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderRadius: 999,
    borderColor: palette.primaryMuted, backgroundColor: palette.primarySubtle, fontFamily: 'Geist Native Text', fontSize: 11, color: palette.accent},
  warning: {marginTop: 16, width: '100%', maxWidth: 560, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderLeftWidth: 3, borderRadius: 4, borderColor: palette.border, borderLeftColor: palette.warning, backgroundColor: `${palette.warning}1a`},
  warningText: {flex: 1, fontFamily: 'Geist Native Text', fontSize: 14, color: palette.text},
});

const useStyles = () => useThemeStyles(makeStyles);
