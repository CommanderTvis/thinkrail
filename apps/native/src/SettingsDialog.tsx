import {useCallback, useEffect, useRef, useState} from 'react';
import {Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, useColorScheme, type View as NativeView} from 'react-native';
import {TextInput as MacTextInput, View} from 'react-native-macos';
import {activeWorkspace, hostClient, useHostClient, type AppConfig, type GithubAuthStatus, type Model, type ProviderStatusReport} from './HostClient';
import {ChatPickerMenu} from './ChatPickerMenu';
import {ThemeMenu} from './ThemeMenu';
import {ANALYTICS_DESCRIPTION, AnalyticsPreferences} from './AnalyticsPreferences';
import {useAnalyticsConsent} from './useAnalyticsConsent';
import {PrimaryButton} from './PrimaryButton';
import {themeMenuPlacement, type ThemeMenuPlacement} from './themeMenuModel';
import {setChatMessageOrder, useChatMessageOrder} from './chatPreferences';
import {Icon, type IconName} from './Icon';
import {ProviderLogin} from './ProviderLogin';
import {ProviderButton, ProviderRow, ProviderSkeleton} from './ProviderRows';
import {JetBrainsAiCard} from './JetBrainsAiCard';
import {tid} from './testId';
import {INTERVIEW_BOOKING_URL} from './InterviewPromptDialog';
import {providerGroups} from './providerPresentation';
import {TemplatesSettings, type TemplateEdit} from './TemplatesSettings';
import {TemplateEditorDialog} from './TemplateEditorDialog';
import {TemplateDeletePopover, type TemplateDelete} from './TemplateDeletePopover';
import {StreamingMovementControl} from './StreamingMovementControl';
import {reviewSelection, type DefaultModel} from './reviewSelection';
import {color} from './WorkbenchPanels';
import {useThemeStyles} from './Theme';
import {deriveThemePair, resolveThemeId, themeChoices, type Palette, type ThemeId} from './themePalette';

export type Section = 'providers' | 'github' | 'appearance' | 'lineWidth' | 'chat' | 'layout' | 'terminal' | 'templates' | 'review' | 'privacy' | 'feedback';
type LayoutMode = 'balanced' | 'focus';
type ReviewPickerKind = 'model' | 'thinking';

const sections: {id: Section; label: string; icon: IconName}[] = [
  {id: 'providers', label: 'Providers', icon: 'key'},
  {id: 'github', label: 'GitHub', icon: 'gitBranch'},
  {id: 'appearance', label: 'Appearance', icon: 'palette'},
  {id: 'lineWidth', label: 'Line width', icon: 'textWrap'},
  {id: 'chat', label: 'Chat', icon: 'chat'},
  {id: 'layout', label: 'Layout', icon: 'layout'},
  {id: 'terminal', label: 'Terminal', icon: 'terminal'},
  {id: 'templates', label: 'Templates', icon: 'layoutGrid'},
  {id: 'review', label: 'Review', icon: 'scan'},
  {id: 'privacy', label: 'Privacy', icon: 'shield'},
  {id: 'feedback', label: 'Feedback', icon: 'feedback'},
];

function Action({label, onPress, disabled = false}: {label: string; onPress: () => void; disabled?: boolean}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <Pressable disabled={disabled} onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[s.save, hovered && s.hovered, disabled && s.disabled]}><Text style={s.choiceLabel}>{label}</Text></Pressable>;
}

function ProvidersSection({report, onReport}: {report: ProviderStatusReport | undefined; onReport: (report: ProviderStatusReport) => void}) {
  const s = useStyles();
  const {login, providerRevision} = useHostClient();
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [busyProvider, setBusyProvider] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showAllKeys, setShowAllKeys] = useState(false);
  const request = useRef({id: 0}).current;
  const load = useCallback(() => {
    const id = ++request.id;
    setRefreshing(true);
    hostClient.providerStatus().then(next => {if (request.id === id) {onReport(next); setError(false);}})
      .catch(() => {if (request.id === id) setError(true);}).finally(() => {if (request.id === id) setRefreshing(false);});
  }, [onReport, request]);
  useEffect(() => {load(); return () => {request.id++;};}, [load, providerRevision, request]);
  useEffect(() => {if (login?.status === 'success') load();}, [login?.status, load]);
  const start = async (providerId: string, type: 'oauth' | 'api_key') => {
    setBusyProvider(providerId);
    setActionError('');
    try {await hostClient.startProviderLogin(providerId, type);}
    catch (reason) {setActionError(String(reason));}
    finally {setBusyProvider('');}
  };
  const logout = async (providerId: string) => {
    setBusyProvider(providerId);
    setActionError('');
    try {await hostClient.logoutProvider(providerId); load();}
    catch (reason) {setActionError(String(reason));}
    finally {setBusyProvider('');}
  };
  const {connected, subscriptions, shownKeys, hiddenKeys, externalSummary} = providerGroups(report?.providers ?? [], showAllKeys);
  const row = (provider: ProviderStatusReport['providers'][number]) => <ProviderRow key={provider.id} provider={provider}
    busy={busyProvider === provider.id || (!provider.configured && Boolean(login))}
    onSignOut={() => logout(provider.id)} onSignIn={() => start(provider.id, 'oauth')} onApiKey={() => start(provider.id, 'api_key')} />;
  return <View {...tid('settings-providers')} style={s.widthSection}>
    <View style={s.providerHeader}><View style={s.providerHeading}>
      <Text style={s.widthTitle}>Model providers</Text>
      <Text style={s.widthDescription}>Connect at least one provider so the agent can run — a subscription or an API key.</Text>
    </View><ProviderButton {...tid('providers-refresh')} ghost icon="refresh" label="Refresh" onPress={load} disabled={refreshing} spinning={refreshing} /></View>
    {actionError ? <Text accessibilityRole="alert" style={[s.widthDescription, s.metadataError]}>{actionError}</Text> : null}
    {!report && !error ? <ProviderSkeleton /> : error ? <View {...tid('providers-error')}><Text style={s.githubText}>Couldn't read the provider status from the host — try Refresh.</Text></View> : <>
      {connected.length ? <View style={s.providerGroup}><Text style={s.providerEyebrow}>Connected</Text>
        <View style={s.providerRows}>{connected.map(row)}</View></View> : null}
      {subscriptions.length ? <View style={s.subscriptionCard}>
        <View style={s.subscriptionHeading}><Text style={s.radioLabel}>Sign in with a subscription</Text>
          <Text style={s.widthDescription}>Use your existing Claude, ChatGPT, or Copilot plan — no API key needed.</Text></View>
        <View style={s.providerRows}>{subscriptions.map(row)}</View>
      </View> : null}
      {report ? <JetBrainsAiCard status={report.jbcentral} install={report.jbcentralInstall} onChanged={load} /> : null}
      {shownKeys.length ? <View style={s.providerGroup}><Text style={s.providerEyebrow}>Add an API key</Text>
        <View style={s.providerRows}>{shownKeys.map(row)}
          {hiddenKeys > 0 ? <View style={s.feedbackAction}><ProviderButton ghost label={`Show ${hiddenKeys} more`} onPress={() => setShowAllKeys(true)} /></View> : null}
        </View></View> : null}
      {externalSummary ? <Text style={s.widthDescription}>{externalSummary}</Text> : null}
    </>}
  </View>;
}

function GithubSection() {
  const s = useStyles();
  const [status, setStatus] = useState<GithubAuthStatus>();
  const [refreshing, setRefreshing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const request = useRef({id: 0}).current;
  const busy = useRef(false);
  const rotation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const id = ++request.id;
    hostClient.githubStatus().then(next => {if (request.id === id) setStatus(next);})
      .catch(() => {if (request.id === id) setStatus({connected: false});});
    return () => {request.id++;};
  }, [request]);
  useEffect(() => {
    if (!refreshing) {rotation.setValue(0); return;}
    const animation = Animated.loop(Animated.timing(rotation, {toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true, isInteraction: false}));
    animation.start();
    return () => animation.stop();
  }, [refreshing, rotation]);
  const refresh = async () => {
    if (busy.current) return;
    busy.current = true;
    const id = ++request.id;
    setRefreshing(true);
    try {
      const next = await hostClient.refreshGithub();
      if (request.id === id) setStatus(next);
    } catch {
      if (request.id === id) setStatus({connected: false});
    } finally {
      busy.current = false;
      if (request.id === id) setRefreshing(false);
    }
  };
  const connected = status?.connected ?? false;
  return <View {...tid('settings-github')} style={s.githubSection}>
    <View style={s.widthHeading}><Text style={s.widthTitle}>Local GitHub</Text>
      <Text style={s.widthDescription}>Authenticate the GitHub CLI to create workspaces from remote branches.</Text></View>
    <View style={s.githubRow}>
      <View {...tid('settings-gh-status', {connected})} style={s.githubStatus}><Icon name={connected ? 'check' : 'close'} color={connected ? color.success : color.muted} size={14} />
        <Text style={[s.githubText, connected && s.githubConnected]}>{connected ? 'Connected' : 'Not connected'}</Text></View>
      {connected && status?.login ? <Text numberOfLines={1} style={[s.githubText, s.githubLogin]}>{status.login}</Text> : null}
      <Pressable {...tid('settings-gh-refresh')} accessibilityRole="button" accessibilityLabel="Refresh GitHub status" accessibilityState={{disabled: refreshing, busy: refreshing}}
        onPress={refresh} disabled={refreshing} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
        style={[s.githubRefresh, hovered && s.hovered, refreshing && s.githubRefreshDisabled]}>
        <Animated.View style={{transform: [{rotate: rotation.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']})}]}}>
          <Icon name="refresh" color={refreshing ? color.disabledText : color.text} size={14} /></Animated.View>
        <Text style={[s.githubText, s.githubRefreshText, refreshing && s.githubDisabledText]}>Refresh</Text>
      </Pressable>
    </View>
    <Text selectable style={s.widthDescription}>The GitHub CLI (<Text style={s.githubCode}>gh</Text>) is read locally on the host.
      {' '}Authenticate with <Text style={s.githubCode}>gh auth login</Text> to enable creating workspaces from remote branches.</Text>
  </View>;
}

type OpenThemePicker = (appearance: 'light' | 'dark', button: NativeView, value: ThemeId, onSelect: (id: ThemeId) => void) => void;

function ThemePicker({appearance, value, disabled, expanded, onOpen}: {
  appearance: 'light' | 'dark'; value: ThemeId; disabled: boolean; expanded: boolean; onOpen: (button: NativeView) => void;
}) {
  const s = useStyles();
  const button = useRef<NativeView>(null);
  const [hovered, setHovered] = useState(false);
  const current = themeChoices.find(theme => theme.id === value && theme.appearance === appearance)
    ?? themeChoices.find(theme => theme.appearance === appearance);
  return <View style={s.themePicker}>
    <Text style={s.choiceLabel}>{appearance === 'light' ? 'Light theme' : 'Dark theme'}</Text>
    <Pressable ref={button} accessibilityRole="button" accessibilityState={{expanded}} accessibilityLabel={`${appearance === 'light' ? 'Light' : 'Dark'} theme: ${current?.label ?? value}`}
      disabled={disabled} onPress={() => {if (button.current) onOpen(button.current);}} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={[s.themeTrigger, hovered && s.hovered, disabled && s.disabled]}>
      <Text style={s.choiceLabel}>{current?.label ?? value}</Text><View style={s.actionSpacer} />
      <Icon name="arrowDown" color={color.muted} size={16} />
    </Pressable>
  </View>;
}

function AppearanceSection({config, onOpenPicker, openAppearance}: {config: AppConfig; onOpenPicker: OpenThemePicker; openAppearance?: 'light' | 'dark'}) {
  const s = useStyles();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const pair = config.systemThemePair ?? deriveThemePair(config.theme);
  const resolved = {light: resolveThemeId({...config, themeMode: 'system'}, 'light'), dark: resolveThemeId({...config, themeMode: 'system'}, 'dark')};
  const update = async (patch: Partial<AppConfig>) => {
    if (pending) return;
    setPending(true);
    setError('');
    try {if (!await hostClient.updateConfig(patch)) setError('Couldn’t change theme');}
    finally {setPending(false);}
  };
  return <View style={s.appearanceSection}>
    <View style={s.widthHeading}><Text style={s.widthTitle}>Theme</Text>
      <Text style={s.widthDescription}>Your mode and pair are saved on the host. Match system follows each device’s light or dark setting.</Text>
    </View>
    <View style={s.radioGroup} accessibilityRole="radiogroup" accessibilityLabel="Theme mode">
    <Choice label="Fixed" description="Use one theme everywhere." active={config.themeMode === 'fixed'} disabled={pending}
      onPress={() => {if (config.themeMode !== 'fixed') update({themeMode: 'fixed'});}} />
    <Choice label="Match system" description="Follow this device’s light or dark setting." active={config.themeMode === 'system'} disabled={pending}
      onPress={() => {if (config.themeMode !== 'system') update({themeMode: 'system', systemThemePair: pair});}} />
    </View>
    {config.themeMode === 'fixed' ? <View style={s.radioGroup}>
      {themeChoices.map(theme => <Choice key={theme.id} label={theme.label} active={config.theme === theme.id} disabled={pending}
        onPress={() => {if (config.theme !== theme.id) update({theme: theme.id, themeMode: 'fixed'});}} />)}
    </View> : <View style={s.appearanceSection}>
      <View style={s.themeCurrent}><Text style={s.choiceHint}>Current on this device</Text>
        <Text style={s.choiceLabel}>{scheme === 'light' ? 'Light' : 'Dark'} → {themeChoices.find(theme => theme.id === resolveThemeId(config, scheme))?.label}</Text></View>
      <ThemePicker appearance="light" value={resolved.light} disabled={pending} expanded={openAppearance === 'light'}
        onOpen={button => onOpenPicker('light', button, resolved.light,
          light => {if (light !== pair.light) update({systemThemePair: {...pair, light}});})} />
      <ThemePicker appearance="dark" value={resolved.dark} disabled={pending} expanded={openAppearance === 'dark'}
        onOpen={button => onOpenPicker('dark', button, resolved.dark,
          dark => {if (dark !== pair.dark) update({systemThemePair: {...pair, dark}});})} />
    </View>}
    {error ? <Text style={s.error}>{error}</Text> : null}
  </View>;
}

function FeedbackSection() {
  const s = useStyles();
  const [error, setError] = useState(false);
  return <View {...tid('settings-feedback')} style={s.widthSection}>
    <View style={s.widthHeading}><Text style={s.widthTitle}>Feedback</Text>
      <Text style={s.widthDescription}>Join us for a user interview, tell us about your experience with ThinkRail, and receive 100 bonus credits in Central (JetBrains AI).</Text></View>
    <View style={s.feedbackAction}><PrimaryButton {...tid('feedback-schedule-interview', {href: INTERVIEW_BOOKING_URL})} icon="externalLink" accessibilityRole="link" label="Schedule an interview" onPress={() => {
      setError(false);
      Linking.openURL(INTERVIEW_BOOKING_URL).catch(() => setError(true));
    }} /></View>
    {error ? <Text accessibilityRole="alert" style={[s.widthDescription, s.metadataError]}>Couldn’t open the booking page.</Text> : null}
  </View>;
}

function PrivacySection({config}: {config: AppConfig}) {
  const s = useStyles();
  const {pending, error, save} = useAnalyticsConsent();
  return <View {...tid('settings-privacy')} style={s.widthSection}>
    <View style={s.widthHeading}><Text style={s.widthTitle}>Usage analytics</Text>
      <Text style={s.widthDescription}>{ANALYTICS_DESCRIPTION}</Text></View>
    <AnalyticsPreferences enabled={config.analyticsEnabled} disabled={pending} onChange={save} />
    {error ? <Text accessibilityRole="alert" style={[s.widthDescription, s.metadataError]}>{error}</Text> : null}
  </View>;
}

function SectionHeading({title, description}: {title: string; description: string}) {
  const s = useStyles();
  return <View style={s.sectionHeading}>
    <Text style={s.sectionTitle}>{title}</Text>
    <Text style={s.description}>{description}</Text>
  </View>;
}

function Choice({label, hint, description, trailingHint = false, active, onPress, disabled = false}: {label: string; hint?: string; description?: string; trailingHint?: boolean; active: boolean; onPress: () => void; disabled?: boolean}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="radio" accessibilityState={{checked: active, disabled}}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[s.choice, hovered && s.hovered, active && s.activeChoice, disabled && s.disabled]}>
    <View style={s.optionCopy}>{description ? <>
      <View style={s.radioTitle}><Text style={s.radioLabel}>{label}</Text>{hint ? <Text style={s.widthDescription}>{hint}</Text> : null}</View>
      <Text style={s.widthDescription}>{description}</Text>
    </> : <><Text style={[s.choiceLabel, s.optionLabel, (active || hovered) && s.optionActive]}>{label}</Text>
      {hint && !trailingHint ? <Text style={s.choiceHint}>{hint}</Text> : null}</>}</View>
    {hint && trailingHint ? <Text style={s.widthDescription}>{hint}</Text> : null}
    {active ? <Icon name="check" color={color.accent} size={16} /> : null}
  </Pressable>;
}

function TerminalSection({config}: {config: AppConfig}) {
  const s = useStyles();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const select = async (size: number) => {
    if (pending || size === config.terminalReplayKb) return;
    setPending(true);
    setError('');
    try {if (!await hostClient.updateConfig({terminalReplayKb: size})) setError("Couldn't change the replay size");}
    finally {setPending(false);}
  };
  return <View style={s.widthSection}><View style={s.appearanceSection}>
    <View style={s.widthHeading}><Text style={s.widthTitle}>Replayed output</Text>
      <Text style={s.widthDescription}>A terminal keeps running when you leave it, but the view is rebuilt from scratch when you come back. This is how much of its recent output the host keeps so the screen is restored too. Applies to terminals opened from now on.</Text>
    </View>
    <View style={s.radioGroup}>{([
      [0, 'Off', 'Reattaching shows an empty screen over the live shell'],
      [16, '16 KB', 'About a screenful'],
      [64, '64 KB', 'A screenful plus scrollback (default)'],
      [256, '256 KB', 'Long scrollback; more memory per terminal'],
      [1024, '1 MB', 'Maximum'],
    ] as const).map(([size, label, hint]) => <Choice key={size} label={label} hint={hint} trailingHint
      active={config.terminalReplayKb === size} disabled={pending} onPress={() => select(size)} />)}</View>
  </View>{error ? <Text style={s.error}>{error}</Text> : null}</View>;
}

function SwitchRow({label, detail, value, disabled = false, accessibilityLabel = label, onChange}: {label: string; detail: string; value: boolean; disabled?: boolean; accessibilityLabel?: string; onChange: (value: boolean) => void}) {
  const s = useStyles();
  return <View style={s.switchRow}>
    <View style={s.switchCopy}><Text style={s.radioLabel}>{label}</Text><Text style={s.widthDescription}>{detail}</Text></View>
    <Pressable disabled={disabled} onPress={() => onChange(!value)} accessibilityLabel={accessibilityLabel}
      accessibilityRole="switch" accessibilityState={{checked: value, disabled}}
      style={[s.switchTrack, value && s.switchTrackOn, disabled && s.disabled]}>
      <View style={[s.switchThumb, value && s.switchThumbOn]} />
    </Pressable>
  </View>;
}

function NavItem({item, active, disabled, onPress}: {item: typeof sections[number]; active: boolean; disabled: boolean; onPress: () => void}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <Pressable {...tid(`settings-nav-${item.id}`, {active})} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{selected: active, disabled}}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[s.navItem, hovered && !active && s.hovered, active && s.navSelected, disabled && s.disabled]}>
    <Icon name={item.icon} color={active ? color.accent : hovered && !disabled ? color.text : color.muted} size={16} />
    <Text style={[s.navLabel, hovered && !disabled && s.hoverText, active && s.activeText]}>{item.label}</Text>
  </Pressable>;
}

function WidthControl({kind, value, bounded}: {kind: 'chat' | 'file'; value: number; bounded: boolean}) {
  const s = useStyles();
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  useEffect(() => setDraft(String(value)), [value]);
  const parsed = Number(draft);
  const valid = /^\d+$/.test(draft) && parsed >= 40 && parsed <= 240;
  const canSave = valid && parsed !== value && !saving;
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError('');
    const saved = await hostClient.updateConfig({[`${kind}LineWidth`]: parsed});
    if (!saved) setSaveError(`Couldn't change the ${kind} line width`);
    setSaving(false);
  };
  const title = kind === 'chat' ? 'Chat' : 'Files';
  return <View style={s.widthControl}>
    <View style={s.widthHeading}><Text style={s.widthTitle}>{title}</Text>
      <Text style={s.widthDescription}>{kind === 'chat'
        ? 'Uses an approximate symbol measure while keeping the current reading font.'
        : 'Soft-wraps source files and both sides of diffs without changing file contents.'}</Text></View>
    <View style={s.numberRow}>
      <View style={s.widthField}><Text style={s.widthDescription}>Line width</Text>
        <View style={s.widthValue}>
          <MacTextInput value={draft} onChangeText={next => {setDraft(next); setSaveError('');}} onSubmitEditing={save}
            keyDownEvents={[{key: 'Escape'}]} onKeyDown={event => {if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); setDraft(String(value)); setSaveError('');}}}
            style={[s.numberInput, !valid && s.invalidInput]} keyboardType="number-pad" accessibilityLabel={`${title} line width`} />
          <Text style={s.widthDescription}>symbols</Text>
        </View>
      </View>
      <Action label={saving ? 'Saving…' : 'Save'} disabled={!canSave} onPress={save} />
    </View>
    {!valid ? <Text style={s.error}>Enter a whole number from 40 to 240.</Text> : null}
    {saveError ? <Text style={s.error}>{saveError}</Text> : null}
    <SwitchRow label="No bigger than pane width" detail={`Wrap sooner when this pane is narrower than ${value} symbols.`}
      value={bounded} onChange={next => hostClient.updateConfig({[`${kind}LineWidthBounded`]: next})} />
  </View>;
}

function ConfigSection({section, config, layoutMode, onLayoutMode}: {
  section: Section; config: AppConfig; layoutMode: LayoutMode; onLayoutMode: (mode: LayoutMode) => void;
}) {
  const s = useStyles();
  const workspace = activeWorkspace(useHostClient());
  const messageOrder = useChatMessageOrder();
  const [growthPending, setGrowthPending] = useState(false);
  const [globalPending, setGlobalPending] = useState(false);
  const [workspacePending, setWorkspacePending] = useState(false);
  const [growthError, setGrowthError] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');
  const selectGrowth = async (composerGrowthLimit: AppConfig['composerGrowthLimit']) => {
    if (growthPending || composerGrowthLimit === config.composerGrowthLimit) return;
    setGrowthPending(true);
    setGrowthError('');
    const saved = await hostClient.updateConfig({composerGrowthLimit});
    setGrowthPending(false);
    if (!saved) setGrowthError('Couldn’t change message box growth');
  };
  const selectGlobal = async (subagentsEnabled: boolean) => {
    if (globalPending || subagentsEnabled === config.subagentsEnabled) return;
    setGlobalPending(true);
    setGlobalError('');
    const saved = await hostClient.updateConfig({subagentsEnabled});
    setGlobalPending(false);
    if (!saved) setGlobalError('Couldn’t change the global subagent default');
  };
  const selectWorkspace = async (override: 'on' | 'off' | null) => {
    if (!workspace || workspacePending || override === (workspace.subagentsOverride ?? null)) return;
    setWorkspacePending(true);
    setWorkspaceError('');
    const saved = await hostClient.setSubagentsOverride(workspace.id, override);
    setWorkspacePending(false);
    if (!saved) setWorkspaceError('Couldn’t change subagents for this workspace');
  };
  if (section === 'lineWidth') return <View style={s.widthSection}>
    <Text style={s.widthDescription}>Set the visual wrap column for chats and source files. These preferences are saved on the host and follow you across connected devices.</Text>
    <WidthControl kind="chat" value={config.chatLineWidth} bounded={config.chatLineWidthBounded} />
    <WidthControl kind="file" value={config.fileLineWidth} bounded={config.fileLineWidthBounded} />
  </View>;
  if (section === 'chat') return <View style={s.reviewSection}>
    <View style={s.chatSettingsIntro}>
    <View style={s.widthHeading}><Text style={s.widthTitle}>Message order</Text>
      <Text style={s.widthDescription}>Choose whether the oldest or newest work appears first. The message box stays at the bottom. Your choice is saved in this client for this host only.</Text></View>
    <View style={s.radioGroup} accessibilityRole="radiogroup" accessibilityLabel="Chat message order">
      <Choice label="Oldest first" hint="Default" description="Shows the earliest request at the top and the latest work at the bottom."
        active={messageOrder === 'oldest-first'} onPress={() => setChatMessageOrder('oldest-first')} />
      <Choice label="Newest first" hint="Latest at top" description="Shows the newest item first inside the latest request-and-answer group, followed by older groups."
        active={messageOrder === 'newest-first'} onPress={() => setChatMessageOrder('newest-first')} />
    </View>
    </View>
    <View style={s.chatSettingsGroup}>
    <View style={s.widthHeading}><Text style={s.widthTitle}>Streaming response movement</Text>
      <Text style={s.widthDescription}>Choose when the chat moves while an answer grows and where its newest edge lands. Your choice is saved in this client for this host only.</Text></View>
    <StreamingMovementControl />
    </View>
    <View style={s.chatSettingsGroup}>
      <View style={s.widthHeading}><Text style={s.widthTitle}>Message box growth</Text>
        <Text style={s.widthDescription}>Choose how tall long drafts may grow before the message box scrolls. Your choice is saved on the host and follows you across devices.</Text></View>
      <View style={s.radioGroup} accessibilityRole="radiogroup" accessibilityLabel="Message box growth limit">
        {([['compact', 'Compact', '6 lines', 'Keeps long drafts to six visual lines before scrolling.'],
          ['roomy', 'Roomy', '10 lines', 'Keeps long drafts to ten visual lines before scrolling.'],
          ['half-chat', 'Half chat', 'Default', 'Uses up to half of the mounted chat panel before scrolling.']] as const).map(([id, label, hint, description]) =>
          <Choice key={id} label={label} hint={hint} description={description} active={config.composerGrowthLimit === id}
            disabled={growthPending} onPress={() => selectGrowth(id)} />)}
      </View>
      {growthError ? <Text accessibilityRole="alert" style={s.error}>{growthError}</Text> : null}
    </View>
    <View style={s.chatSettingsGroup}>
    <View style={s.widthHeading}><Text style={s.widthTitle}>Subagents</Text>
      <Text style={s.widthDescription}>Choose whether chats may delegate work to specialized agents. Turning this off prevents new subagents; work already running finishes.</Text></View>
    <SwitchRow label="Global default" detail={config.subagentsEnabled
      ? 'On — workspaces may delegate unless they override it.'
      : 'Off — workspaces cannot delegate unless they override it.'}
      value={config.subagentsEnabled} disabled={globalPending} accessibilityLabel="Enable subagents by default" onChange={selectGlobal} />
    {globalError ? <Text accessibilityRole="alert" style={s.error}>{globalError}</Text> : null}
    {workspace ? <View style={s.chatSettingsGroup}>
      <View style={s.widthHeading}><Text style={s.radioLabel}>This workspace — {workspace.name}</Text>
        <Text style={s.widthDescription}>Override the global default only for this workspace.</Text></View>
      <View style={s.radioGroup} accessibilityRole="radiogroup" accessibilityLabel={`Subagents in ${workspace.name}`}>
        <Choice label="Use global" hint={config.subagentsEnabled ? 'Currently on' : 'Currently off'}
          description="Follows the global default, including later changes." disabled={workspacePending}
          active={!workspace.subagentsOverride} onPress={() => selectWorkspace(null)} />
        <Choice label="On" hint="Override" description="Always allow delegation in this workspace." disabled={workspacePending}
          active={workspace.subagentsOverride === 'on'} onPress={() => selectWorkspace('on')} />
        <Choice label="Off" hint="Override" description="Prevent new subagents in this workspace." disabled={workspacePending}
          active={workspace.subagentsOverride === 'off'} onPress={() => selectWorkspace('off')} />
      </View>
      {workspaceError ? <Text accessibilityRole="alert" style={s.error}>{workspaceError}</Text> : null}
    </View> : null}
    </View>
  </View>;
  if (section === 'layout') return <View style={s.section}>
    <SectionHeading title="Layout" description="Apply a layout to this window. The frame stays local to this device." />
    <Choice label="Balanced" hint="Projects, workspace, Specs and Files, Changes and Review, terminal"
      active={layoutMode === 'balanced'} onPress={() => onLayoutMode('balanced')} />
    <Choice label="Focus" hint="Only the center workbench" active={layoutMode === 'focus'} onPress={() => onLayoutMode('focus')} />
  </View>;
  if (section === 'terminal') return <TerminalSection config={config} />;
  return <PrivacySection config={config} />;
}

function ReviewPickerControl({label, disabled = false, onOpen}: {label: string; disabled?: boolean; onOpen: (button: NativeView) => void}) {
  const s = useStyles();
  const button = useRef<NativeView>(null);
  const [hovered, setHovered] = useState(false);
  return <Pressable ref={button} disabled={disabled} accessibilityRole="button" accessibilityState={{disabled}}
    onPress={() => {if (button.current) onOpen(button.current);}}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[s.reviewPickerControl, hovered && s.hovered, disabled && s.disabled]}>
    <Text numberOfLines={1} style={s.reviewPickerLabel}>{label}</Text><Icon name="arrowDown" color={color.muted} size={12} />
  </Pressable>;
}

function ReviewSection({config, selection, error, onOpenPicker}: {
  config: AppConfig; selection: ReturnType<typeof reviewSelection>; error: string; onOpenPicker: (kind: ReviewPickerKind, button: NativeView) => void;
}) {
  const s = useStyles();
  return <View style={s.reviewSection}>
    <View style={s.widthHeading}><Text style={s.widthTitle}>Reviewer model</Text>
      <Text style={s.widthDescription}>The model the plan reviewer runs on. Leave unset to use your default model. Your choice is saved on the host and follows you across devices.</Text></View>
    <View style={s.reviewControls}>
      <ReviewPickerControl label={selection.label} onOpen={button => onOpenPicker('model', button)} />
      <ReviewPickerControl label={selection.levels.length ? selection.level : 'N/A'} disabled={!selection.levels.length}
        onOpen={button => onOpenPicker('thinking', button)} />
    </View>
    {error ? <Text style={s.error}>{error}</Text> : null}
    <View style={s.widthHeading}><Text style={s.widthTitle}>Agent-triggered review</Text>
      <Text style={s.widthDescription}>When on, the worker reviews each completed plan step itself (via its request_review tool) during the session. When off, that tool is withheld and review happens only when you press the Review button.</Text></View>
    <SwitchRow label="Let the agent request review" detail={config.agentReviewEnabled
      ? 'On — the worker reviews its own completed steps in-session.' : 'Off — only the Review button starts a review.'}
      value={config.agentReviewEnabled} onChange={agentReviewEnabled => hostClient.updateConfig({agentReviewEnabled})} />
    <View style={s.widthHeading}><Text style={s.widthTitle}>Automatic fix cycle</Text>
      <Text style={s.widthDescription}>When on, a “changes requested” verdict is sent to the worker chat automatically (once) and the fix is re-reviewed without asking. When off, the reviewer only records its findings and waits for you.</Text></View>
    <SwitchRow label="Auto-fix requested changes" detail={config.reviewAutoFix
      ? "On — the reviewer's findings are auto-sent to the worker and re-reviewed once." : 'Off — findings wait for you; nothing is auto-sent.'}
      value={config.reviewAutoFix} onChange={reviewAutoFix => hostClient.updateConfig({reviewAutoFix})} />
  </View>;
}

export function SettingsDialog({onClose, layoutMode, onLayoutMode, onOpenFile, initialSection = 'appearance'}: {
  initialSection?: Section;
  onClose: () => void; layoutMode: LayoutMode; onLayoutMode: (mode: LayoutMode) => void; onOpenFile: (path: string) => void;
}) {
  const s = useStyles();
  const {config, login, models, workspaceId} = useHostClient();
  const [providerReport, setProviderReport] = useState<ProviderStatusReport>();
  const [section, setSection] = useState<Section>(initialSection);
  const [hoveredClose, setHoveredClose] = useState(false);
  const dialog = useRef<NativeView>(null);
  const overlay = useRef<NativeView>(null);
  useEffect(() => {overlay.current?.focus();}, []);
  const [templateEdit, setTemplateEdit] = useState<TemplateEdit>();
  const [templateDelete, setTemplateDelete] = useState<TemplateDelete>();
  const [templatesVersion, setTemplatesVersion] = useState(0);
  const templatesChanged = () => setTemplatesVersion(value => value + 1);
  const dismissTemplateEdit = () => {templateEdit?.button.focus(); setTemplateEdit(undefined);};
  const dismissTemplateDelete = () => {templateDelete?.button.focus(); setTemplateDelete(undefined);};
  useEffect(() => {setTemplateEdit(undefined); setTemplateDelete(undefined);}, [workspaceId]);
  const [reviewFallback, setReviewFallback] = useState<DefaultModel | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [reviewPicker, setReviewPicker] = useState<{kind: ReviewPickerKind; button: NativeView} | null>(null);
  const [themePicker, setThemePicker] = useState<{
    appearance: 'light' | 'dark'; value: ThemeId; placement: ThemeMenuPlacement; button: NativeView; onSelect: (id: ThemeId) => void;
  } | null>(null);
  useEffect(() => {setThemePicker(null);}, [section, config]);
  const dismissThemePicker = () => {themePicker?.button.focus(); setThemePicker(null);};
  const openThemePicker: OpenThemePicker = (appearance, button, value, onSelect) => {
    button.measureInWindow((x, y, width, height) => {
      dialog.current?.measureInWindow((dialogX, dialogY, dialogWidth, dialogHeight) => {
        const menuHeight = themeChoices.filter(theme => theme.appearance === appearance).length * 28 + 10;
        setReviewPicker(null);
        setThemePicker({appearance, value, button, onSelect,
          placement: themeMenuPlacement({x, y, width, height}, {x: dialogX, y: dialogY, width: dialogWidth, height: dialogHeight}, menuHeight)});
      });
    });
  };
  useEffect(() => {
    if (section !== 'review') return;
    let active = true;
    setReviewError('');
    hostClient.defaultModel().then(value => {if (active) setReviewFallback(value);})
      .catch(reason => {if (active) setReviewError(String(reason));});
    hostClient.refreshModels(false).catch(reason => {if (active) setReviewError(String(reason));});
    return () => {active = false;};
  }, [section]);
  const openReviewPicker = (kind: ReviewPickerKind, button: NativeView) => {
    setReviewPicker({kind, button});
  };
  const saveReview = async (update: {reviewModel?: Model | null; reviewEffort?: string | null}) => {
    setReviewPicker(null);
    setReviewError('');
    if (!await hostClient.updateConfig(update)) setReviewError("Couldn't change the review model");
  };
  const selection = reviewSelection(config, reviewFallback);
  const close = () => {
    if (templateEdit) {dismissTemplateEdit(); return;}
    if (templateDelete) {dismissTemplateDelete(); return;}
    if (themePicker) {dismissThemePicker(); return;}
    if (login?.status === 'active') hostClient.cancelProviderLogin().catch(() => {});
    else if (login) hostClient.clearProviderLogin();
    onClose();
  };
  return <View ref={overlay} focusable style={s.overlay} keyDownEvents={[{key: 'Escape'}]}
    onLayout={() => {if (templateDelete) dismissTemplateDelete();}}
    onKeyDown={event => {if (event.nativeEvent.key === 'Escape') {if (themePicker) dismissThemePicker(); else if (reviewPicker) setReviewPicker(null); else close();}}}>
    <Pressable style={s.backdrop} onPress={close} />
    <View style={s.dialogFrame}><View ref={dialog} {...tid('settings-dialog')} style={s.dialog} onLayout={() => {if (themePicker) dismissThemePicker();}}>
      <View style={s.titleBar}><Text style={s.title}>Settings</Text><Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close settings"
        onHoverIn={() => setHoveredClose(true)} onHoverOut={() => setHoveredClose(false)} style={[s.closeButton, hoveredClose && s.hovered]}>
        <Icon name="close" color={hoveredClose ? color.text : color.muted} size={16} /></Pressable></View>
      <View style={s.body}>
        <ScrollView style={s.nav} contentContainerStyle={s.navContent}>
          {sections.map(item => <NavItem key={item.id} item={item} active={section === item.id}
            disabled={login?.status === 'active' && item.id !== 'providers'} onPress={() => setSection(item.id)} />)}
          <View style={s.navItem} accessibilityLabel="General, coming soon">
            <Icon name="sliders" color={color.disabledText} size={16} /><Text style={[s.navLabel, s.soonText]}>General</Text>
            <View style={s.soonBadge}><Text style={s.soonLabel}>Soon</Text></View>
          </View>
        </ScrollView>
        <ScrollView style={s.content} contentContainerStyle={s.contentInner}>
          {section === 'providers' ? <ProvidersSection report={providerReport} onReport={setProviderReport} /> : section === 'github' ? <GithubSection />
            : section === 'appearance' && config ? <AppearanceSection config={config} onOpenPicker={openThemePicker} openAppearance={themePicker?.appearance} />
            : section === 'templates' ? <TemplatesSettings version={templatesVersion} onChanged={templatesChanged} onEdit={setTemplateEdit}
              onOpenFile={path => {onOpenFile(path); onClose();}} onDelete={(template, button) => {
                button.measureInWindow((x, y, width, height) => overlay.current?.measureInWindow((rootX, rootY, rootWidth, rootHeight) => {
                  setTemplateDelete({template, button, anchor: {x: x - rootX, y: y - rootY, width, height}, bounds: {width: rootWidth, height: rootHeight}});
                }));
              }} />
            : section === 'feedback' ? <FeedbackSection />
            : section === 'review' && config ? <ReviewSection config={config} selection={selection} error={reviewError} onOpenPicker={openReviewPicker} />
            : config ? <ConfigSection key={`${section}:${workspaceId}`} section={section} config={config} layoutMode={layoutMode} onLayoutMode={onLayoutMode} />
            : <Text style={s.description}>Connect to the host to manage settings.</Text>}
        </ScrollView>
      </View>
      {themePicker ? <ThemeMenu appearance={themePicker.appearance} value={themePicker.value} placement={themePicker.placement}
        onDismiss={dismissThemePicker} onSelect={id => {dismissThemePicker(); themePicker.onSelect(id);}} /> : null}
      {reviewPicker && config ? <ChatPickerMenu key={reviewPicker.kind} kind={reviewPicker.kind} anchor={reviewPicker.button} models={models}
        currentModel={selection.model} levels={selection.levels} currentLevel={selection.level}
        defaultOption={{label: selection.defaultLabel,
          onSelect: () => saveReview({reviewModel: null, reviewEffort: null})}}
        onDismiss={() => setReviewPicker(null)} onSelectModel={reviewModel => saveReview({reviewModel})}
        onSelectThinking={reviewEffort => saveReview({reviewEffort})} /> : null}
    </View></View>
    {login ? <ProviderLogin key={login.loginId} login={login}
      providerName={providerReport?.providers.find(provider => provider.id === login.providerId)?.name ?? login.providerId} /> : null}
    {templateEdit ? <TemplateEditorDialog key={`${templateEdit.scope}:${templateEdit.template?.name ?? 'new'}:${workspaceId}`}
      edit={templateEdit} workspaceId={workspaceId || undefined} onClose={dismissTemplateEdit} onSaved={templatesChanged} /> : null}
    {templateDelete ? <TemplateDeletePopover target={templateDelete} workspaceId={workspaceId || undefined}
      onClose={dismissTemplateDelete} onDeleted={templatesChanged} /> : null}
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  overlay: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 20, alignItems: 'center', justifyContent: 'center'},
  backdrop: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)'},
  dialogFrame: {width: 832, maxWidth: '100%', height: '80%', borderRadius: 8, backgroundColor: palette.elevated,
    shadowColor: '#000000', shadowOffset: {width: 0, height: 8}, shadowRadius: 14, shadowOpacity: palette.dialogShadowOpacity},
  dialog: {flex: 1, backgroundColor: palette.elevated, borderRadius: 8, borderWidth: 1, borderColor: palette.border, overflow: 'hidden'},
  titleBar: {borderBottomWidth: 1, borderColor: palette.border, paddingHorizontal: 16, paddingVertical: 12},
  closeButton: {position: 'absolute', right: 12, top: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 4},
  title: {fontFamily: 'Geist SemiBold', color: palette.text, fontSize: 14, lineHeight: 17.5}, body: {flex: 1, flexDirection: 'row'},
  nav: {width: 192, flexGrow: 0, borderRightWidth: 1, borderColor: palette.border, backgroundColor: palette.elevated},
  navContent: {padding: 12, gap: 2}, navItem: {borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8},
  navSelected: {backgroundColor: palette.primarySubtle}, navLabel: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 14, lineHeight: 20},
  hoverText: {color: palette.text}, activeText: {color: palette.accent}, soonText: {color: palette.disabledText},
  soonBadge: {marginLeft: 'auto', borderWidth: 1, borderColor: palette.border, borderRadius: 999, paddingHorizontal: 4, paddingVertical: 2},
  soonLabel: {fontFamily: 'Geist Medium', color: palette.disabledText, fontSize: 12, lineHeight: 18.46, letterSpacing: 0.24, textTransform: 'uppercase'},
  content: {flex: 1}, contentInner: {padding: 16}, section: {gap: 10}, sectionHeading: {gap: 4, marginBottom: 4},
  reviewSection: {gap: 16}, reviewControls: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  reviewPickerControl: {maxWidth: '100%', minHeight: 28, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: palette.border, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 4},
  reviewPickerLabel: {fontFamily: 'Geist Native Text', fontSize: 12, color: palette.text, flexShrink: 1},
  actionSpacer: {flex: 1},
  providerHeader: {flexDirection: 'row', alignItems: 'flex-start', gap: 8}, providerHeading: {flex: 1, gap: 4},
  providerGroup: {gap: 8}, providerRows: {gap: 4},
  providerEyebrow: {fontFamily: 'Geist Medium', color: palette.muted, fontSize: 12, lineHeight: 19.2, letterSpacing: 0.24, textTransform: 'uppercase'},
  subscriptionCard: {gap: 8, padding: 12, borderWidth: 1, borderColor: palette.primaryMuted, borderRadius: 4, backgroundColor: palette.primarySubtle},
  subscriptionHeading: {gap: 2},
  feedbackAction: {alignSelf: 'flex-start'},
  themePicker: {gap: 4}, themeTrigger: {height: 32, paddingHorizontal: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 8},
  themeCurrent: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8},
  githubSection: {gap: 8},
  githubRow: {borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 4, backgroundColor: palette.input, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8},
  githubStatus: {flexDirection: 'row', alignItems: 'center', gap: 4},
  githubText: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 14, lineHeight: 20},
  githubConnected: {color: palette.success}, githubLogin: {flexShrink: 1},
  githubRefresh: {marginLeft: 'auto', height: 28, paddingHorizontal: 8, gap: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.border, borderRadius: 4, backgroundColor: palette.input},
  githubRefreshText: {color: palette.text}, githubDisabledText: {color: palette.disabledText},
  githubRefreshDisabled: {backgroundColor: `${palette.input}99`, borderColor: `${palette.border}99`},
  githubCode: {fontFamily: 'JetBrains Mono', fontSize: 13, lineHeight: 20.8, fontWeight: '400'},
  sectionTitle: {fontFamily: 'Geist', color: palette.text, fontSize: 15, fontWeight: '600'}, description: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12, lineHeight: 18},
  choice: {borderWidth: 1, borderColor: palette.border, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8},
  hovered: {backgroundColor: palette.hover}, activeChoice: {borderColor: palette.primaryMuted, backgroundColor: palette.primarySubtle},
  appearanceSection: {gap: 8}, optionLabel: {color: palette.muted, fontSize: 14, lineHeight: 20}, optionActive: {color: palette.text},
  optionCopy: {flex: 1},
  choiceCopy: {flex: 1, gap: 3}, choiceLabel: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 13}, choiceHint: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 11, lineHeight: 16},
  radioGroup: {gap: 4}, radioTitle: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4},
  chatSettingsIntro: {gap: 8}, chatSettingsGroup: {gap: 8, borderTopWidth: 1, borderColor: palette.border, paddingTop: 16},
  radioLabel: {fontFamily: 'Geist Medium', color: palette.text, fontSize: 12, lineHeight: 19.2},
  switchRow: {borderWidth: 1, borderColor: palette.border, borderRadius: 4, backgroundColor: palette.input, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12},
  switchCopy: {flex: 1, gap: 2},
  switchTrack: {width: 36, height: 20, borderRadius: 10, backgroundColor: palette.border, padding: 2},
  switchTrackOn: {backgroundColor: palette.accent}, switchThumb: {width: 16, height: 16, borderRadius: 8, backgroundColor: palette.surface},
  switchThumbOn: {alignSelf: 'flex-end'},
  widthSection: {gap: 16}, widthHeading: {gap: 4}, widthField: {gap: 4},
  widthTitle: {fontFamily: 'Geist Medium', color: palette.text, fontSize: 14, lineHeight: 22.4},
  widthDescription: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12, lineHeight: 16},
  widthControl: {gap: 12, borderTopWidth: 1, borderColor: palette.border, paddingTop: 16},
  widthValue: {flexDirection: 'row', alignItems: 'center', gap: 8},
  numberRow: {flexDirection: 'row', alignItems: 'flex-end', gap: 8}, numberInput: {fontFamily: 'Geist Native Text', width: 96, height: 30, borderWidth: 1, borderColor: palette.border, borderRadius: 4, backgroundColor: palette.surface, color: palette.text, fontSize: 14, paddingHorizontal: 8},
  invalidInput: {borderColor: palette.red},
  save: {paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: palette.border, borderRadius: 4}, disabled: {opacity: 0.45},
  error: {fontFamily: 'Geist Native Text', color: palette.red, fontSize: 11},
  metadataError: {color: palette.red},
});

const useStyles = () => useThemeStyles(makeStyles);
