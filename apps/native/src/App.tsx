import {type ReactNode, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Clipboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type GestureResponderEvent, type StyleProp, type ViewStyle} from 'react-native';
import {AnalyticsConsentDialog} from './AnalyticsConsentDialog';
import {initChatPreferences} from './chatPreferences';
import {closeCenterTab, emptyCenterTabs, openCenterTab, selectCenterTab, type CenterTab, type CenterTabs} from './centerTabs';

type WorkspaceTabs = {center: CenterTabs; bottom: CenterTabs};
const noWorkspaceTabs: WorkspaceTabs = {center: emptyCenterTabs(), bottom: emptyCenterTabs()};
import {activeWorkspace, hostClient, useHostClient, workspacesOf, type DiffScope, type Project, type Workspace} from './HostClient';
import {Icon, type IconName} from './Icon';
import {JbcentralQuotaTopbar} from './JbcentralQuotaTopbar';
import {ProjectOpenMenu} from './ProjectOpenMenu';
import {SettingsDialog, type Section} from './SettingsDialog';
import {SkillsDialog} from './SkillsDialog';
import {isRunning, needsAttention} from './sessionAttention';
import {SpinningIcon} from './SpinningIcon';
import {ChangesPane, ChatPane, color, DiffPane, EditorPane, FilesPane, ListRow, ReviewPane, SkillsPane, SpecsPane, TasksPane, TerminalPane} from './WorkbenchPanels';
import {useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {emptyPromptImages} from './PromptImageChips';
import type {PromptImageDraft} from './promptImageModel';
import {emptyComposerDraft, type ComposerDraft} from './composerDraft';
import {INITIAL_TERMINAL_TAB_KEY} from '../../../packages/contracts/src';
import {tid} from './testId';
import {ConfirmDialog} from './ConfirmDialog';
import {ExistingWorktreeDialog} from './ExistingWorktreeDialog';
import {View as MacView} from 'react-native-macos';
import {setProjectExpanded, useCollapsedProjects, initRailExpansion} from './railExpansion';
import {Welcome} from './Welcome';
import {Toaster} from './Toaster';
import {readActiveScope, writeActiveScope} from './activeScope';
import {ChatHistory, titleCommit} from './ChatHistory';
import {InterviewPromptDialog} from './InterviewPromptDialog';
import {NewWorkspaceDialog} from './NewWorkspaceDialog';

type WorkspaceMenu = {workspace: Workspace; x: number; y: number; editorsOpen?: boolean};
const scopeKey = (scope: DiffScope) => scope.kind === 'commit' ? `commit:${scope.sha}` : scope.kind;

function HoverButton({children, onPress, style, hoverStyle, label, testID}: {
  children: ReactNode; onPress: () => void; style?: StyleProp<ViewStyle>; hoverStyle?: ViewStyle; label?: string; testID?: string;
}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[style, hovered && (hoverStyle ?? s.hovered)]}>{children}</Pressable>;
}

function TabNameInput({initial, onEnd}: {initial: string; onEnd: (title: string | null) => void}) {
  const s = useStyles();
  const [value, setValue] = useState(initial);
  const latest = useRef(initial);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    onEnd(save ? titleCommit(latest.current) : null);
  };
  return <TextInput {...tid('chat-tab-name-input')} autoFocus value={value} onChangeText={text => {latest.current = text; setValue(text);}}
    onSubmitEditing={() => finish(true)} onBlur={() => finish(true)}
    {...{keyDownEvents: [{key: 'Escape'}], onKeyDown: (event: {nativeEvent: {key: string}; stopPropagation: () => void}) => {if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); finish(false);}}}} style={s.tabNameInput} />;
}

function Tab({label, icon, selected, onPress, onClose, onContextMenu, renaming, onRenamed, testID}: {
  label: string; icon?: IconName; selected?: boolean; onPress: () => void; onClose?: () => void; testID?: string;
  onContextMenu?: (x: number, y: number) => void; renaming?: boolean; onRenamed?: (title: string | null) => void;
}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <Pressable testID={testID} accessibilityRole="tab" onPress={event => {
    if ((event.nativeEvent as {button?: number}).button === 2) onContextMenu?.(event.nativeEvent.pageX, event.nativeEvent.pageY);
    else onPress();
  }} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[s.tab, hovered && !selected && s.tabHovered, selected && s.tabSelected]}>
    {icon ? <Icon name={icon} color={selected ? color.text : color.muted} size={14} /> : null}
    {renaming && onRenamed ? <TabNameInput initial={label} onEnd={onRenamed} />
      : <Text numberOfLines={1} style={[s.tabLabel, selected && s.tabLabelSelected]}>{label}</Text>}
    {onClose ? <Pressable {...tid('editor-tab-close')} accessibilityRole="button" accessibilityLabel={`Close ${label}`} onPress={event => {event.stopPropagation(); onClose();}}
      style={s.tabClose}><Icon name="close" color={color.muted} size={13} /></Pressable> : null}
  </Pressable>;
}

function RenameInput({workspace, onEnd}: {workspace: Workspace; onEnd: () => void}) {
  const s = useStyles();
  const {connection} = useHostClient();
  const [initial] = useState(workspace.name);
  const [value, setValue] = useState(initial);
  const latest = useRef(initial);
  const [queued, setQueued] = useState<string | null>(null);
  const done = useRef(false);
  const submit = useCallback(async (next: string) => {
    if (await hostClient.renameWorkspace(workspace.id, next)) {done.current = true; onEnd();}
    else setQueued(next);
  }, [workspace.id, onEnd]);
  useEffect(() => {
    if (queued !== null && connection === 'connected') {setQueued(null); submit(queued);}
  }, [queued, connection, submit]);
  const finish = (save: boolean) => {
    if (done.current) return;
    const next = latest.current.trim();
    if (!save || !next || next === initial) {done.current = true; onEnd(); return;}
    if (connection === 'connected') submit(next);
    else setQueued(next);
  };
  const input = useRef<TextInput>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelection(0, initial.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [initial]);
  return <TextInput ref={input} {...tid('workspace-rename-input')} accessibilityLabel="Workspace name" value={value}
    onChangeText={text => {latest.current = text; setValue(text);}} onSubmitEditing={() => finish(true)} onBlur={() => finish(true)}
    {...{keyDownEvents: [{key: 'Escape'}], onKeyDown: (event: {nativeEvent: {key: string}; stopPropagation: () => void}) => {if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); finish(false);}}}}
    style={s.workspaceNameInput} />;
}

function WorkspaceRow({workspace, selected, editing, attention, running, onOpenMenu, onEndRename}: {
  workspace: Workspace; selected: boolean; editing: boolean; attention: boolean; running: boolean;
  onOpenMenu: (workspace: Workspace, x: number, y: number) => void; onEndRename: () => void;
}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  const button = useRef<View>(null);
  const openMenu = () => button.current?.measureInWindow((x, y, width, height) => onOpenMenu(workspace, x + width, y + height));
  const press = (event: GestureResponderEvent) => {
    if ((event.nativeEvent as {button?: number}).button === 2) openMenu();
    else if (!editing) hostClient.selectWorkspace(workspace.id);
  };
  return <Pressable {...tid('workspace-item', {kind: workspace.kind ?? 'worktree', active: selected, project: workspace.projectId, attention: attention || undefined, running: running || undefined})}
    onPress={press} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={s.workspaceRow}>
    <ListRow label={workspace.name} subtitle={workspace.branch} labelTestID="workspace-name" subtitleTestID="workspace-branch"
      labelNode={editing ? <RenameInput workspace={workspace} onEnd={onEndRename} /> : undefined}
      icon={workspace.kind === 'default' ? 'homeFill' : 'gitBranch'} spinning={running} depth={1} selected={selected}
      style={s.workspaceListRow} onPress={press} />
    {attention ? <AttentionDot /> : null}
    <Pressable ref={button} {...tid('workspace-menu', {visible: hovered || editing})} accessibilityRole="button" accessibilityLabel={`Actions for ${workspace.name}`}
      onPress={openMenu} style={[s.workspaceMenuButton, !hovered && !editing && s.workspaceMenuHidden]}>
      <Icon name="more" color={color.muted} size={14} />
    </Pressable>
  </Pressable>;
}

function AttentionDot() {
  const s = useStyles();
  return <View {...tid('attention-dot')} accessibilityRole="image" accessibilityLabel="Needs attention" style={s.attention}><View style={s.attentionDot} /></View>;
}

type ProjectMenu = {project: Project; x: number; y: number};

function ProjectRow({project, selected, expanded, attention, running, workspaceCount, menuOpen, onSelect, onToggle, onAddWorkspace, onOpenMenu}: {
  project: Project; selected: boolean; expanded: boolean; attention: boolean; running: boolean; workspaceCount: number; menuOpen: boolean;
  onSelect: () => void; onToggle: () => void; onAddWorkspace: () => void; onOpenMenu: (x: number, y: number) => void;
}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <Pressable {...tid('project-item', {id: project.id, active: selected, 'menu-open': menuOpen, attention: attention || undefined, running: running || undefined})}
    onPress={event => {
      if ((event.nativeEvent as {button?: number}).button === 2) onOpenMenu(event.nativeEvent.pageX, event.nativeEvent.pageY);
      else onSelect();
    }}
    onLongPress={event => onOpenMenu(event.nativeEvent.pageX, event.nativeEvent.pageY)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[s.projectItem, (hovered || menuOpen) && s.hovered]}>
    <Pressable {...tid('project-expand', {expanded})} accessibilityRole="button"
      accessibilityLabel={expanded ? 'Collapse project' : 'Expand project'} onPress={onToggle} style={s.projectExpand}>
      <Icon name={expanded ? 'arrowDown' : 'arrowRight'} color={color.muted} size={14} />
    </Pressable>
    <Pressable {...tid('project-name')} accessibilityRole="button" onPress={onSelect} style={s.projectName}>
      {running ? <SpinningIcon name="loader" color={selected ? color.accent : color.muted} size={14} />
        : <Icon name={selected ? 'folderFill' : 'folder'} color={selected ? color.accent : color.muted} size={14} />}
      <Text numberOfLines={1} style={[s.projectNameText, selected && s.projectNameSelected]}>{project.name}</Text>
    </Pressable>
    {attention ? <AttentionDot /> : null}
    {!expanded && workspaceCount > 0 ? <View {...tid('project-workspace-count')}><Text style={s.muted}>{workspaceCount}</Text></View> : null}
    <HoverButton testID="add-workspace" style={s.projectAdd} hoverStyle={s.hovered} label="Create workspace" onPress={onAddWorkspace}>
      <Icon name="add" color={color.muted} size={14} />
    </HoverButton>
  </Pressable>;
}

function Navigation({frameStyle, renamingId, onEndRename, onOpenWorkspaceMenu, onOpenProjectMenu, onNewWorkspace}: {
  frameStyle: ViewStyle; renamingId: string; onEndRename: () => void;
  onOpenWorkspaceMenu: (workspace: Workspace, x: number, y: number) => void;
  onOpenProjectMenu: (anchor: {x: number; y: number}) => void;
  onNewWorkspace: (projectId: string) => void;
}) {
  const s = useStyles();
  const state = useHostClient();
  const collapsed = useCollapsedProjects();
  const addProject = useRef<View>(null);
  const rail = useRef<View>(null);
  const [menu, setMenu] = useState<ProjectMenu | null>(null);
  const [closing, setClosing] = useState<Project | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const projectIds = state.projects.map(project => project.id).join(',');
  useEffect(() => {
    for (const id of projectIds.split(',')) if (id) hostClient.loadProjectWorkspaces(id).catch(() => {});
  }, [projectIds]);
  const openMenu = (project: Project, x: number, y: number) =>
    rail.current?.measureInWindow((left, top) => setMenu({project, x: x - left, y: y - top}));
  return <View ref={rail} {...tid('left-nav')} style={[s.sidebar, frameStyle]}>
    <View style={s.sideTab}><Icon name="folderTab" color={color.text} size={15} /><Text style={s.sideTabLabel}>Projects</Text></View>
    <View style={s.sectionHead}>
      <Text style={s.sectionTitle}>PROJECTS</Text>
      <View ref={addProject} collapsable={false}>
        <HoverButton testID="add-project-menu" style={s.projectAdd} label="Add project"
          onPress={() => addProject.current?.measureInWindow((x, y, _width, height) => onOpenProjectMenu({x, y: y + height + 4}))}>
          <Icon name="add" color={color.muted} size={18} />
        </HoverButton>
      </View>
    </View>
    <ScrollView {...tid('project-tree')} style={s.projectList}>
      {state.projects.map(project => {
        const expanded = !collapsed.has(project.id);
        const workspaces = workspacesOf(state, project.id);
        return <View key={project.id}>
          <ProjectRow project={project} selected={state.projectId === project.id && !state.workspaceId} expanded={expanded}
            attention={!expanded && needsAttention(state.sessionStates, {projectId: project.id})} running={!expanded && isRunning(state.sessionStates, {projectId: project.id})}
            workspaceCount={workspaces.filter(workspace => workspace.kind !== 'default').length} menuOpen={menu?.project.id === project.id}
            onSelect={() => hostClient.selectProject(project.id)} onToggle={() => setProjectExpanded(project.id, !expanded)}
            onAddWorkspace={() => onNewWorkspace(project.id)} onOpenMenu={(x, y) => openMenu(project, x, y)} />
          {expanded ? workspaces.map(workspace => <WorkspaceRow key={workspace.id} workspace={workspace}
            selected={state.workspaceId === workspace.id} editing={renamingId === workspace.id}
            attention={needsAttention(state.sessionStates, {workspaceId: workspace.id})} running={isRunning(state.sessionStates, {workspaceId: workspace.id})}
            onEndRename={onEndRename} onOpenMenu={onOpenWorkspaceMenu} />) : null}
        </View>;
      })}
      {!state.projects.length ? <Text style={s.empty}>{state.connection === 'connected' ? 'Open a repository to begin.' : 'Waiting for the host…'}</Text> : null}
    </ScrollView>
    {menu ? <MacView style={s.projectMenuLayer} keyDownEvents={[{key: 'Escape'}]}
      onKeyDown={event => {if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); setMenu(null);}}}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(null)} />
      <View {...tid('project-actions')} accessibilityRole="menu" style={[s.workspaceMenu, {left: menu.x, top: menu.y}]}>
        <MenuItem testID="project-menu-create-workspace" label="Create workspace" icon="add"
          onPress={() => {setMenu(null); onNewWorkspace(menu.project.id);}} />
        <MenuItem testID="project-menu-open-existing-worktree" label="Open existing worktree…" icon="folderOpen"
          onPress={() => {setMenu(null); setExisting(menu.project.id);}} />
        <View style={s.workspaceMenuSeparator} />
        <MenuItem testID="project-menu-close" label="Close project" icon="close"
          onPress={() => {setMenu(null); setClosing(menu.project);}} />
      </View>
    </MacView> : null}
    {existing ? <ExistingWorktreeDialog projectId={existing} onClose={() => setExisting(null)} /> : null}
    {closing ? <ConfirmDialog title={`Close ${closing.name}?`}
      description="Removes this project from the open projects list. Its repository, workspaces, chats, and running activity are kept. Reopen it from Add project → Recents."
      confirmLabel="Close project" confirmTestId="confirm-close-project" onCancel={() => setClosing(null)}
      onConfirm={() => {setClosing(null); hostClient.closeProject(closing.id).catch(error => hostClient.reportError(String(error)));}} /> : null}
  </View>;
}

function MenuItem({label, icon, destructive, onPress, testID}: {label: string; icon: IconName; destructive?: boolean; onPress: () => void; testID?: string}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <Pressable testID={testID} accessibilityRole="menuitem" onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[s.workspaceMenuItem, hovered && s.hovered]}>
    <Icon name={icon} color={destructive ? color.red : color.muted} size={15} />
    <Text style={[s.workspaceMenuItemText, destructive && s.workspaceMenuDestructive]}>{label}</Text>
  </Pressable>;
}

function WorkspaceCanvas({onNewChat}: {onNewChat: () => void}) {
  const s = useStyles();
  const state = useHostClient();
  const workspace = activeWorkspace(state);
  const project = state.projects.find(item => item.id === workspace?.projectId);
  const isDefault = workspace?.kind === 'default';
  const isExternal = workspace?.kind === 'external';
  return <View {...tid('workspace-ready')} style={s.workspaceCanvas}>
    <Text style={s.canvasEyebrow}>{isDefault ? 'Default workspace' : isExternal ? 'Existing worktree' : 'Workspace ready'}</Text>
    {workspace ? <>
      <Text numberOfLines={1} style={s.canvasTitle}>{isDefault ? project?.name ?? workspace.name : workspace.name}</Text>
      <View style={s.canvasBranch}><Icon name="gitBranch" color={color.muted} size={14} />
        <Text numberOfLines={1} style={s.muted}>{isDefault || isExternal ? `on ${workspace.branch}` : `${workspace.branch} · from ${workspace.baseBranch}`}</Text>
      </View>
    </> : null}
    <Text style={s.canvasDescription}>{isDefault ? 'Chats, changes, and terminals run directly in your project folder.'
      : 'Files, chats, changes, and terminals are scoped to this workspace.'}</Text>
    <HoverButton testID="start-chat" style={s.outlineButton} hoverStyle={s.outlineHovered} onPress={onNewChat}>
      <Icon name="chatNew" color={color.text} size={15} /><Text style={s.outlineText}>New chat</Text>
    </HoverButton>
  </View>;
}

function Center({tabs, activeId, bottomTabs, setBottomTabs, onOpenChat, chatDrafts, chatImages, onChatImagesChange, onChatDraftChange, onSelectTab, onCloseTab, onNewChat, onOpenSkills, onOpenTerminal, onOpenFile, onManageTemplates, focus, terminalStyle}: {
  tabs: CenterTab[]; activeId: string; bottomTabs: CenterTabs; setBottomTabs: (update: (current: CenterTabs) => CenterTabs) => void; onOpenChat: (sessionId: string) => void; onSelectTab: (id: string) => void; onCloseTab: (id: string) => void;
  chatDrafts: Record<string, ComposerDraft>; onChatDraftChange: (sessionId: string, draft: SetStateAction<ComposerDraft>) => void;
  chatImages: Record<string, PromptImageDraft>; onChatImagesChange: (sessionId: string, images: SetStateAction<PromptImageDraft>) => void;
  onNewChat: () => void; onOpenSkills: () => void; onManageTemplates: () => void;
  onOpenTerminal: () => void; onOpenFile: (path: string) => void; focus: boolean; terminalStyle: ViewStyle;
}) {
  const s = useStyles();
  const state = useHostClient();
  const active = tabs.find(tab => tab.id === activeId);
  const [tabMenu, setTabMenuState] = useState<{tab: CenterTab; x: number; y: number} | null>(null);
  const centerRoot = useRef<View>(null);
  const setTabMenu = (menu: {tab: CenterTab; x: number; y: number} | null) => {
    if (!menu) {setTabMenuState(null); return;}
    centerRoot.current?.measureInWindow((left, top) => setTabMenuState({...menu, x: menu.x - left, y: menu.y - top}));
  };
  const [renamingTab, setRenamingTab] = useState('');
  const openChatIds = new Set(tabs.flatMap(tab => tab.kind === 'chat' ? [tab.sessionId] : []));
  const closedSessions = state.sessions.filter(session => !openChatIds.has(session.sessionId))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const bottomActive = bottomTabs.tabs.find(tab => tab.id === bottomTabs.activeId);
  const newBottomTerminal = () => {hostClient.openTerminal().then(tabKey => {
    if (tabKey) setBottomTabs(current => openCenterTab(current, {id: `terminal:${tabKey}`, kind: 'terminal', tabKey}));
  });};
  const closeBottomTerminal = (tabKey: string) => {hostClient.closeTerminal(tabKey).then(closed => {
    if (closed) setBottomTabs(current => closeCenterTab(current, `terminal:${tabKey}`));
  });};
  return <View ref={centerRoot} style={s.center}>
    {tabMenu ? <MacView style={s.tabMenuLayer} keyDownEvents={[{key: 'Escape'}]}
      onKeyDown={event => {if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); setTabMenu(null);}}}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setTabMenu(null)} />
      <View {...tid('tab-menu')} accessibilityRole="menu" style={[s.workspaceMenu, {left: tabMenu.x, top: tabMenu.y}]}>
        <MenuItem testID="tab-menu-rename" label="Rename chat" icon="pencil"
          onPress={() => {const id = tabMenu.tab.id; setTabMenu(null); requestAnimationFrame(() => setRenamingTab(id));}} />
        <MenuItem testID="tab-menu-close" label="Close" icon="close" onPress={() => {const id = tabMenu.tab.id; setTabMenu(null); onCloseTab(id);}} />
      </View>
    </MacView> : null}
    <View {...tid('center-tabs')} style={s.centerTabs}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.centerTabScroll} contentContainerStyle={s.centerTabList}>
        {tabs.map(tab => <Tab key={tab.id}
          label={tab.kind === 'chat' ? state.sessions.find(session => session.sessionId === tab.sessionId)?.title ?? 'Chat'
            : tab.kind === 'terminal' ? state.terminalTabs.find(item => item.tabKey === tab.tabKey)?.title ?? 'Terminal'
            : tab.kind === 'diff' ? `${tab.path.split('/').at(-1)} (diff)` : tab.path.split('/').at(-1) ?? 'File'}
          icon={tab.kind === 'chat' ? 'chat' : tab.kind === 'terminal' ? 'terminal' : tab.kind === 'diff' ? 'diff' : 'fileFill'} selected={tab.id === activeId}
          testID={tid(tab.kind === 'terminal' ? 'terminal-tab' : 'editor-tab', {kind: tab.kind === 'editor' ? 'file' : tab.kind, active: tab.id === activeId,
            'session-id': tab.kind === 'chat' ? tab.sessionId : undefined}).testID}
          onPress={() => onSelectTab(tab.id)} onClose={() => onCloseTab(tab.id)}
          onContextMenu={tab.kind === 'chat' ? (x, y) => setTabMenu({tab, x, y}) : undefined}
          renaming={tab.kind === 'chat' && renamingTab === tab.id}
          onRenamed={tab.kind === 'chat' ? title => {
            setRenamingTab('');
            const current = state.sessions.find(session => session.sessionId === tab.sessionId)?.title;
            if (title && title !== current) hostClient.renameSession(state.workspaceId, tab.sessionId, title);
          } : undefined} />)}
      </ScrollView>
      <ChatHistory sessions={closedSessions} onOpen={onOpenChat} />
      <HoverButton testID="open-skills" style={s.tabTool} label="Skills" onPress={onOpenSkills}><Icon name="sparkle" color={color.muted} size={16} /></HoverButton>
      <HoverButton testID="new-chat" style={s.tabTool} label="New chat" onPress={onNewChat}><Icon name="chatNew" color={color.muted} size={16} /></HoverButton>
      <HoverButton style={s.tabTool} label="New terminal in center" onPress={onOpenTerminal}><Icon name="terminal" color={color.muted} size={16} /></HoverButton>
    </View>
    <View style={s.centerBody}>
      {!active ? <WorkspaceCanvas onNewChat={onNewChat} />
        : active.kind === 'chat' ? state.sessionId === active.sessionId
          ? <ChatPane key={active.sessionId} composerDraft={chatDrafts[active.sessionId] ?? emptyComposerDraft} onComposerDraftChange={draft => onChatDraftChange(active.sessionId, draft)}
            attachments={chatImages[active.sessionId] ?? emptyPromptImages} onAttachmentsChange={images => onChatImagesChange(active.sessionId, images)} onOpenFile={onOpenFile} onManageTemplates={onManageTemplates} />
          : <Text style={s.empty}>Opening chat…</Text>
          : active.kind === 'terminal' ? <TerminalPane key={active.tabKey} tabKey={active.tabKey} />
          : active.kind === 'editor' ? state.filePath === active.path ? <EditorPane onOpenFile={onOpenFile} /> : <Text style={s.empty}>Opening file…</Text>
            : state.diffPath === active.path && scopeKey(state.diffScope) === scopeKey(active.scope) ? <DiffPane /> : <Text style={s.empty}>Opening diff…</Text>}
    </View>
    {!focus ? <View {...tid('terminal-panel')} style={[s.terminal, terminalStyle]}>
      <View style={s.terminalTabs}>
        {bottomTabs.tabs.map(tab => tab.kind === 'terminal' ? <Tab key={tab.tabKey}
          testID={tid('terminal-tab', {active: tab.id === bottomTabs.activeId, 'tab-key': tab.tabKey}).testID}
          label={state.terminalTabs.find(item => item.tabKey === tab.tabKey)?.title ?? 'Terminal'} icon="terminal"
          selected={tab.id === bottomTabs.activeId}
          onPress={() => {setBottomTabs(current => selectCenterTab(current, tab.id)); hostClient.ensureTerminalAttached(tab.tabKey);}}
          onClose={() => closeBottomTerminal(tab.tabKey)} /> : null)}
        <View style={s.tabSpacer} />
        <HoverButton testID="terminal-add" style={s.tabTool} label="New terminal below" onPress={newBottomTerminal}><Icon name="add" color={color.muted} size={16} /></HoverButton>
      </View>
      {bottomActive?.kind === 'terminal' ? <TerminalPane key={bottomActive.tabKey} tabKey={bottomActive.tabKey} /> : <View style={s.terminalEmpty}>
        <HoverButton style={s.outlineButton} hoverStyle={s.outlineHovered} onPress={newBottomTerminal}><Icon name="terminal" color={color.text} size={15} /><Text style={s.outlineText}>New terminal</Text></HoverButton>
      </View>}
    </View> : null}
  </View>;
}

function Inspector({onOpenFile, onOpenDiff, frameStyle}: {
  onOpenFile: (path: string) => void; onOpenDiff: (path: string, scope: DiffScope) => void; frameStyle: ViewStyle;
}) {
  const s = useStyles();
  const [upper, setUpper] = useState<'specs' | 'files' | 'tasks' | 'skills'>('specs');
  const [lower, setLower] = useState<'changes' | 'review'>('changes');
  const [moreOpen, setMoreOpen] = useState(false);
  return <View {...tid('right-panel')} style={[s.inspector, frameStyle]}>
    <View style={s.inspectorUpper}>
      <View style={s.inspectorTabs}>
        <Tab testID={tid('tab-specs', {active: upper === 'specs'}).testID} label="Specs" icon={upper === 'specs' ? 'bookFill' : 'book'} selected={upper === 'specs'} onPress={() => setUpper('specs')} />
        <Tab testID={tid('tab-files', {active: upper === 'files'}).testID} label="Files" icon={upper === 'files' ? 'fileFill' : 'file'} selected={upper === 'files'} onPress={() => setUpper('files')} />
        {upper === 'tasks' || upper === 'skills' ? <Tab label={upper === 'tasks' ? 'Tasks' : 'Skills'} icon={upper === 'tasks' ? 'list' : 'sparkle'} selected onPress={() => {}} /> : null}
        <View style={s.tabSpacer} />
        <HoverButton style={s.tabTool} label="Add tool tab" onPress={() => setMoreOpen(!moreOpen)}><Icon name="add" color={color.muted} size={16} /></HoverButton>
      </View>
      {moreOpen ? <View style={s.moreMenu}>
        <HoverButton onPress={() => {setUpper('tasks'); setMoreOpen(false);}}><Text style={s.moreItem}>Tasks</Text></HoverButton>
        <HoverButton onPress={() => {setUpper('skills'); setMoreOpen(false);}}><Text style={s.moreItem}>Skills</Text></HoverButton>
      </View> : null}
      {upper === 'specs' ? <SpecsPane onOpenFile={onOpenFile} /> : upper === 'files' ? <FilesPane onOpenFile={onOpenFile} /> : upper === 'tasks' ? <TasksPane /> : <SkillsPane />}
    </View>
    <View style={s.inspectorLower}>
      <View style={s.inspectorTabs}>
        <Tab testID={tid('tab-changes', {active: lower === 'changes'}).testID} label="Changes" icon="fileDiff" selected={lower === 'changes'} onPress={() => setLower('changes')} />
        <Tab testID={tid('tab-review', {active: lower === 'review'}).testID} label="Review" icon="discuss" selected={lower === 'review'} onPress={() => setLower('review')} />
        <View style={s.tabSpacer} />
      </View>
      {lower === 'changes' ? <ChangesPane onOpenDiff={onOpenDiff} /> : <ReviewPane />}
    </View>
  </View>;
}

export default function App({hostURL, workspaceId, benchmarkPort}: {hostURL: string; workspaceId?: string; benchmarkPort?: string}) {
  const s = useStyles();
  const state = useHostClient();
  const [tabsByWorkspace, setTabsByWorkspace] = useState<Record<string, WorkspaceTabs>>({});
  const workspaceTabs = tabsByWorkspace[state.workspaceId] ?? noWorkspaceTabs;
  const centerTabs = workspaceTabs.center;
  const updateTabs = useCallback((region: keyof WorkspaceTabs, update: (current: CenterTabs) => CenterTabs) => {
    const current = hostClient.getSnapshot().workspaceId;
    if (!current) return;
    setTabsByWorkspace(all => {
      const tabs = all[current] ?? noWorkspaceTabs;
      return {...all, [current]: {...tabs, [region]: update(tabs[region])}};
    });
  }, []);
  const setCenterTabs = useCallback((update: (current: CenterTabs) => CenterTabs) => updateTabs('center', update), [updateTabs]);
  const setBottomTabs = useCallback((update: (current: CenterTabs) => CenterTabs) => updateTabs('bottom', update), [updateTabs]);
  const hasInitialTerminal = state.terminalTabs.some(tab => tab.tabKey === INITIAL_TERMINAL_TAB_KEY);
  useEffect(() => {
    if (!hasInitialTerminal) return;
    const id = `terminal:${INITIAL_TERMINAL_TAB_KEY}`;
    setBottomTabs(current => current.tabs.some(tab => tab.id === id) || centerTabs.tabs.some(tab => tab.id === id)
      ? current : openCenterTab(current, {id, kind: 'terminal', tabKey: INITIAL_TERMINAL_TAB_KEY}));
  }, [hasInitialTerminal, state.workspaceId, centerTabs.tabs, setBottomTabs]);
  const bottomActive = workspaceTabs.bottom.tabs.find(tab => tab.id === workspaceTabs.bottom.activeId);
  useEffect(() => {
    if (bottomActive?.kind === 'terminal') hostClient.ensureTerminalAttached(bottomActive.tabKey);
  }, [bottomActive]);
  const [chatDrafts, setChatDrafts] = useState<Record<string, ComposerDraft>>({});
  const [chatImages, setChatImages] = useState<Record<string, PromptImageDraft>>({});
  const [settingsOpen, setSettingsOpen] = useState<Section>();
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState<{x: number; y: number} | null>(null);
  const [newWorkspace, setNewWorkspace] = useState<{projectId: string; prompt: string; note?: string} | null>(null);
  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceMenu | null>(null);
  const [renamingId, setRenamingId] = useState('');
  const [removeWorkspace, setRemoveWorkspace] = useState<Workspace | null>(null);
  const [layoutMode, setLayoutMode] = useState<'balanced' | 'focus'>('balanced');
  const [viewport, setViewport] = useState({width: 1352, height: 720});
  const frame = useMemo(() => StyleSheet.create({
    sidebar: {width: Math.max(180, Math.min(300, Math.round(viewport.width * 0.18)))},
    inspector: {width: Math.max(260, Math.min(500, Math.round(viewport.width * 0.28)))},
    terminal: {height: Math.max(170, Math.round((viewport.height - 40) * 0.3))},
  }), [viewport.width, viewport.height]);
  const reportedWorkspace = useRef(false);
  const reportedWorkbench = useRef(false);
  useEffect(() => initChatPreferences(hostURL), [hostURL]);
  useEffect(() => initRailExpansion(hostURL), [hostURL]);
  useEffect(() => {
    const stored = readActiveScope(hostURL);
    hostClient.start(hostURL, workspaceId || stored.workspaceId, stored.projectId);
    return () => hostClient.stop();
  }, [hostURL, workspaceId]);
  useEffect(() => {
    if (state.connection === 'connected' && state.projectId) writeActiveScope(hostURL, {projectId: state.projectId, workspaceId: state.workspaceId});
  }, [hostURL, state.connection, state.projectId, state.workspaceId]);
  const openChatSession = useCallback((sessionId: string) => setCenterTabs(current => openCenterTab(current,
    {id: `chat:${sessionId}`, kind: 'chat', sessionId})), [setCenterTabs]);
  const activeTab = centerTabs.tabs.find(tab => tab.id === centerTabs.activeId);
  const seededWorkspaces = useRef(new Set<string>());
  useEffect(() => {
    const id = state.workspaceId;
    if (!id || state.sessionsFor !== id || seededWorkspaces.current.has(id)) return;
    seededWorkspaces.current.add(id);
    if ((tabsByWorkspace[id]?.center.tabs.length ?? 0) > 0) return;
    const withTodos = state.sessions.filter(session => (session.openTodos ?? 0) > 0);
    const newest = [...state.sessions].sort((left, right) => right.updatedAt - left.updatedAt)[0];
    for (const session of withTodos.length ? withTodos : newest ? [newest] : []) openChatSession(session.sessionId);
  }, [state.workspaceId, state.sessionsFor, state.sessions, tabsByWorkspace, openChatSession]);
  useEffect(() => {
    if (!state.removedSessionIds.length) return;
    const removed = new Set(state.removedSessionIds);
    setTabsByWorkspace(all => {
      let changed = false;
      const next = Object.fromEntries(Object.entries(all).map(([id, tabs]) => {
        const center = tabs.center.tabs.filter(tab => tab.kind === 'chat' && removed.has(tab.sessionId))
          .reduce((current, tab) => {changed = true; return closeCenterTab(current, tab.id);}, tabs.center);
        return [id, {...tabs, center}];
      }));
      return changed ? next : all;
    });
  }, [state.removedSessionIds]);
  useEffect(() => {
    if (activeTab?.kind === 'chat' && hostClient.getSnapshot().sessionId !== activeTab.sessionId) {
      const tabId = activeTab.id;
      hostClient.selectSession(activeTab.sessionId).then(opened => {if (!opened) setCenterTabs(current => closeCenterTab(current, tabId));});
    }
    if (activeTab?.kind === 'terminal') hostClient.ensureTerminalAttached(activeTab.tabKey);
    if (activeTab?.kind === 'editor') hostClient.openFile(activeTab.path);
    if (activeTab?.kind !== 'diff') return;
    let current = true;
    const load = async () => {
      if (scopeKey(hostClient.getSnapshot().diffScope) !== scopeKey(activeTab.scope)) await hostClient.setDiffScope(activeTab.scope);
      if (current) await hostClient.openDiff(activeTab.path);
    };
    load().catch(() => {});
    return () => {current = false;};
  }, [activeTab, setCenterTabs]);
  const hasActiveWorkspace = activeWorkspace(state) !== undefined;
  useEffect(() => {
    if (!reportedWorkspace.current && hasActiveWorkspace) {
      reportedWorkspace.current = true;
      if (benchmarkPort) fetch(`http://127.0.0.1:${benchmarkPort}/workspace?at=${Date.now()}`).catch(() => {});
    }
  }, [benchmarkPort, hasActiveWorkspace]);
  useEffect(() => {
    if (!reportedWorkbench.current && state.files.length && state.sessionId && Object.keys(state.terminalInstances).length) {
      reportedWorkbench.current = true;
      if (benchmarkPort) fetch(`http://127.0.0.1:${benchmarkPort}/ready?at=${Date.now()}`).catch(() => {});
    }
  }, [benchmarkPort, state.files.length, state.sessionId, state.terminalInstances]);
  const openFile = (path: string) => setCenterTabs(current => openCenterTab(current, {id: `file:${path}`, kind: 'editor', path}));
  const openDiff = (path: string, scope: DiffScope) => setCenterTabs(current => openCenterTab(current,
    {id: `diff:${scopeKey(scope)}:${path}`, kind: 'diff', path, scope}));
  const newChat = () => {hostClient.createSession().then(sessionId => {if (sessionId) openChatSession(sessionId);});};
  const openTerminal = () => {hostClient.openTerminal().then(tabKey => {
    if (tabKey) setCenterTabs(current => openCenterTab(current, {id: `terminal:${tabKey}`, kind: 'terminal', tabKey}));
  });};
  const closeTab = (id: string) => {
    const tab = centerTabs.tabs.find(item => item.id === id);
    if (tab?.kind === 'terminal') {
      hostClient.closeTerminal(tab.tabKey).then(closed => {if (closed) setCenterTabs(current => closeCenterTab(current, id));});
    } else setCenterTabs(current => closeCenterTab(current, id));
  };
  const project = state.projects.find(item => item.id === state.projectId);
  const workspace = activeWorkspace(state);
  return <View {...tid('shell')} style={s.root} onStartShouldSetResponderCapture={event => {
    const focused = TextInput.State.currentlyFocusedInput();
    if (focused && event.target !== focused) TextInput.State.blurTextInput(focused);
    return false;
  }} onLayout={event => {
    const {width, height} = event.nativeEvent.layout;
    setViewport(current => current.width === width && current.height === height ? current : {width, height});
  }}>
    <View style={s.topbar}>
      <View {...tid('brand-logo', {label: 'ThinkRail', color: color.accent, width: 32, height: 32})} accessibilityLabel="ThinkRail" style={s.brand}><Icon name="brand" color={color.accent} size={32} /></View>
      <View style={s.breadcrumb}>
        {project ? <View {...tid('scope-context', {context: workspace ? 'workspace' : 'project-home'})} style={s.breadcrumb}>
          <View {...tid('scope-project')}><Text numberOfLines={1} style={s.breadcrumbText}>{project.name}</Text></View>
          <Icon name="arrowRight" color={color.muted} size={16} />
          <View {...tid('scope-name')}><Text numberOfLines={1} style={s.breadcrumbText}>{workspace?.name ?? 'Project home'}</Text></View>
          {workspace ? <><Icon name="gitBranch" color={color.muted} size={14} />
            <View {...tid('scope-branch')}><Text numberOfLines={1} style={s.branchText}>{workspace.branch}</Text></View>
            {workspace.kind !== 'default' && workspace.kind !== 'external'
              ? <View {...tid('scope-base')}><Text numberOfLines={1} style={s.branchText}>· from {workspace.baseBranch}</Text></View> : null}</> : null}
        </View> : null}
      </View>
      <JbcentralQuotaTopbar state={state} />
      <View {...tid('connection-status', {status: state.connection, label: state.connection === 'connected' ? 'Connected' : state.connection === 'connecting' ? 'Connecting' : 'Disconnected'})} style={s.connection}><Icon name={state.connection === 'connected' ? 'circleFill' : 'circle'} color={state.connection === 'connected' ? color.success : color.warning} size={9} /><Text style={s.connectionText}>{state.connection === 'connected' ? 'Connected' : state.connection}</Text></View>
      <HoverButton testID="open-settings" style={s.topButton} label="Settings" onPress={() => setSettingsOpen('providers')}><Icon name="settings" color={color.muted} size={18} /></HoverButton>
    </View>
    {state.error ? <View {...tid('host-error')} style={s.errorBar}><Text numberOfLines={1} style={s.errorText}>{state.error}</Text></View> : null}
    <View style={s.main}>
      {layoutMode === 'balanced' ? <Navigation frameStyle={frame.sidebar} renamingId={renamingId}
        onEndRename={() => setRenamingId('')}
        onOpenWorkspaceMenu={(item, x, y) => setWorkspaceMenu({workspace: item, x, y})}
        onOpenProjectMenu={setProjectMenu} onNewWorkspace={projectId => setNewWorkspace({projectId, prompt: ''})} /> : null}
      {!workspace ? <Welcome settingsOpen={settingsOpen !== undefined} onOpenProjectMenu={setProjectMenu}
        onConnectProvider={() => setSettingsOpen('providers')}
        onNewWorkspace={(projectId, prompt, note) => setNewWorkspace({projectId, prompt, note})} /> : <>
      <Center tabs={centerTabs.tabs} activeId={centerTabs.activeId} bottomTabs={workspaceTabs.bottom} setBottomTabs={setBottomTabs} onOpenChat={openChatSession} chatDrafts={chatDrafts} chatImages={chatImages}
        onChatImagesChange={(sessionId, images) => setChatImages(current => ({...current, [sessionId]: typeof images === 'function' ? images(current[sessionId] ?? emptyPromptImages) : images}))}
        onChatDraftChange={(sessionId, text) => setChatDrafts(current => ({...current, [sessionId]: typeof text === 'function' ? text(current[sessionId] ?? emptyComposerDraft) : text}))}
        onOpenFile={openFile} onNewChat={newChat} onOpenSkills={() => setSkillsOpen(true)} onManageTemplates={() => setSettingsOpen('templates')}
        onOpenTerminal={openTerminal}
        onSelectTab={id => setCenterTabs(current => selectCenterTab(current, id))}
        onCloseTab={closeTab}
        focus={layoutMode === 'focus'} terminalStyle={frame.terminal} />
      {layoutMode === 'balanced' ? <Inspector onOpenFile={openFile} onOpenDiff={openDiff} frameStyle={frame.inspector} /> : null}
      </>}
    </View>
    <ProjectOpenMenu open={projectMenu !== null} onClose={() => setProjectMenu(null)} anchor={projectMenu ?? {x: 0, y: 0}} />
    {newWorkspace ? <NewWorkspaceDialog projectId={newWorkspace.projectId} initialPrompt={newWorkspace.prompt} promptNote={newWorkspace.note}
      onClose={() => setNewWorkspace(null)} onChatStarted={openChatSession} /> : null}
    {skillsOpen ? <SkillsDialog onClose={() => setSkillsOpen(false)} /> : null}
    {settingsOpen ? <SettingsDialog initialSection={settingsOpen} onClose={() => setSettingsOpen(undefined)} layoutMode={layoutMode} onLayoutMode={setLayoutMode} onOpenFile={openFile} /> : null}
    {workspaceMenu ? <MacView style={s.workspaceMenuLayer} keyDownEvents={[{key: 'Escape'}]}
      onKeyDown={event => {if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); setWorkspaceMenu(null);}}}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setWorkspaceMenu(null)} />
      <View {...tid('workspace-actions')} accessibilityRole="menu" style={[s.workspaceMenu, {left: Math.max(8, Math.min(viewport.width - 216, workspaceMenu.x - 204)),
        top: Math.max(8, Math.min(viewport.height - 260, workspaceMenu.y))}]}>
        {workspaceMenu.editorsOpen ? <>
          <MenuItem label="‹  Open in" icon="externalLink" onPress={() => setWorkspaceMenu({...workspaceMenu, editorsOpen: false})} />
          {state.editors.filter(editor => editor.kind === 'gui').map(editor => <MenuItem key={editor.id} testID={tid('workspace-open-in-editor', {editor: editor.id}).testID} label={editor.label}
            icon="externalLink" onPress={() => {hostClient.openWorkspaceIn(workspaceMenu.workspace.id, editor.id); setWorkspaceMenu(null);}} />)}
        </> : <>
          {state.editors.some(editor => editor.kind === 'gui') ? <MenuItem testID="workspace-open-in" label="Open in  ›" icon="externalLink"
            onPress={() => setWorkspaceMenu({...workspaceMenu, editorsOpen: true})} /> : null}
          {workspaceMenu.workspace.kind !== 'default' && workspaceMenu.workspace.kind !== 'external' ? <MenuItem testID="workspace-rename" label="Rename" icon="pencil"
            onPress={() => {const id = workspaceMenu.workspace.id; setWorkspaceMenu(null); requestAnimationFrame(() => setRenamingId(id));}} /> : null}
          <MenuItem testID="workspace-copy-path" label="Copy path" icon="copy" onPress={() => {Clipboard.setString(workspaceMenu.workspace.worktreePath); setWorkspaceMenu(null);}} />
          <MenuItem testID="workspace-reveal" label="Reveal in file manager" icon="folderOpen"
            onPress={() => {hostClient.revealWorkspace(workspaceMenu.workspace.id); setWorkspaceMenu(null);}} />
          {workspaceMenu.workspace.kind !== 'default' ? <>
            <View style={s.workspaceMenuSeparator} />
            <MenuItem testID="workspace-remove" label={workspaceMenu.workspace.kind === 'external' ? 'Remove from ThinkRail' : 'Remove workspace'} icon="trash"
              destructive onPress={() => {setRemoveWorkspace(workspaceMenu.workspace); setWorkspaceMenu(null);}} />
          </> : null}
        </>}
      </View>
    </MacView> : null}
    {removeWorkspace ? <ConfirmDialog
      title={removeWorkspace.kind === 'external' ? `Remove ${removeWorkspace.name} from ThinkRail?` : `Remove ${removeWorkspace.name} workspace?`}
      description={removeWorkspace.kind === 'external'
        ? `Its ThinkRail chats and terminals will be removed. The existing checkout, files, and branch ${removeWorkspace.branch} stay untouched.`
        : `Its chats, terminals, and worktree will be deleted. The git branch ${removeWorkspace.branch} stays available.`}
      confirmLabel={removeWorkspace.kind === 'external' ? 'Remove from ThinkRail' : 'Remove workspace'} confirmTestId="confirm-remove"
      onCancel={() => setRemoveWorkspace(null)}
      onConfirm={() => {hostClient.removeWorkspace(removeWorkspace.id); setRemoveWorkspace(null);}} /> : null}
    {state.interviewPrompt && state.config?.analyticsConsentConfirmed ? <InterviewPromptDialog /> : null}
    <Toaster />
    {state.connection === 'connected' && state.config && !state.config.analyticsConsentConfirmed
      ? <AnalyticsConsentDialog /> : null}
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  root: {flex: 1, backgroundColor: palette.bg}, main: {flex: 1, flexDirection: 'row'},
  topbar: {height: 40, paddingLeft: 78, paddingRight: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface, borderBottomWidth: 1, borderColor: palette.border},
  brand: {marginRight: 12}, breadcrumb: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6}, breadcrumbText: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 14}, branchText: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12},
  connection: {flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 14}, connectionText: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 14}, topButton: {padding: 5},
  sidebar: {backgroundColor: palette.sidebar, borderRightWidth: 1, borderColor: palette.border},
  sideTab: {height: 32, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, borderBottomWidth: 2, borderBottomColor: palette.accent, width: 94},
  sideTabLabel: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 14}, sectionHead: {height: 50, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  sectionTitle: {fontFamily: 'Geist', color: palette.muted, fontSize: 12, fontWeight: '600'}, projectList: {flex: 1}, projectAdd: {width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 4},
  projectItem: {height: 28, marginHorizontal: 12, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 4},
  projectExpand: {width: 16, height: 16, alignItems: 'center', justifyContent: 'center'},
  projectName: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4},
  projectNameText: {flexShrink: 1, fontFamily: 'Geist Native Text', fontSize: 14, color: palette.muted}, projectNameSelected: {color: palette.text},
  projectMenuLayer: {...StyleSheet.absoluteFillObject, zIndex: 12},
  tabMenuLayer: {...StyleSheet.absoluteFillObject, zIndex: 12},
  tabNameInput: {flexShrink: 1, minWidth: 80, padding: 0, margin: 0, color: palette.text, fontFamily: 'Geist Native Text', fontSize: 14}, workspaceRow: {position: 'relative'}, workspaceListRow: {paddingRight: 32, marginHorizontal: 12},
  workspaceMenuButton: {position: 'absolute', right: 10, top: 8, width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 4},
  workspaceMenuHidden: {opacity: 0}, attention: {width: 20, height: 20, alignItems: 'center', justifyContent: 'center'}, attentionDot: {width: 6, height: 6, borderRadius: 3, backgroundColor: palette.accent}, workspaceNameInput: {fontFamily: 'Geist Native Text', fontSize: 14, color: palette.text, padding: 0, margin: 0, minWidth: 100, flex: 1},
  workspaceMenuLayer: {...StyleSheet.absoluteFillObject, zIndex: 10},
  workspaceMenu: {position: 'absolute', width: 208, padding: 4, borderRadius: 6, borderWidth: 1, borderColor: palette.borderStrong, backgroundColor: palette.elevated},
  workspaceMenuItem: {minHeight: 30, paddingHorizontal: 8, flexDirection: 'row', gap: 9, alignItems: 'center', borderRadius: 4},
  workspaceMenuItemText: {fontFamily: 'Geist Native Text', fontSize: 13, color: palette.text},
  workspaceMenuDestructive: {fontFamily: 'Geist Native Text', fontSize: 13, color: palette.red},
  workspaceMenuSeparator: {height: 1, backgroundColor: palette.border, marginVertical: 4},
  muted: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12}, empty: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 11, padding: 12},
  center: {flex: 1, minWidth: 380, backgroundColor: palette.content}, centerTabs: {height: 32, flexDirection: 'row', borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.bg},
  centerTabScroll: {flex: 1}, centerTabList: {flexDirection: 'row'},
  centerBody: {flex: 1}, workspaceCanvas: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30},
  canvasEyebrow: {fontFamily: 'Geist', color: palette.muted, fontSize: 12, fontWeight: '600', marginBottom: 4}, canvasTitle: {fontFamily: 'Geist', color: palette.text, fontSize: 18, marginBottom: 4},
  canvasBranch: {flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8}, canvasDescription: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 14, textAlign: 'center', marginBottom: 8},
  outlineButton: {borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 5}, outlineHovered: {backgroundColor: palette.hover}, outlineText: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 14},
  terminal: {borderTopWidth: 1, borderColor: palette.border, backgroundColor: palette.bg}, terminalTabs: {height: 32, flexDirection: 'row', borderBottomWidth: 1, borderColor: palette.border},
  terminalEmpty: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  inspector: {borderLeftWidth: 1, borderColor: palette.border}, inspectorUpper: {flex: 1.25, backgroundColor: palette.sidebar},
  inspectorLower: {flex: 1, borderTopWidth: 1, borderColor: palette.border, backgroundColor: palette.bg}, inspectorTabs: {height: 32, flexDirection: 'row', borderBottomWidth: 1, borderColor: palette.border},
  tab: {minWidth: 85, maxWidth: 170, height: 32, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRightWidth: 1, borderColor: palette.border},
  hovered: {backgroundColor: palette.hover}, tabHovered: {backgroundColor: palette.hover}, tabSelected: {backgroundColor: palette.hover, borderBottomWidth: 2, borderBottomColor: palette.accent}, tabLabel: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 14, flexShrink: 1}, tabLabelSelected: {color: palette.text},
  tabClose: {width: 20, height: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto'},
  tabSpacer: {flex: 1}, tabTool: {width: 32, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderColor: palette.border},
  moreMenu: {position: 'absolute', top: 32, right: 2, width: 100, zIndex: 2, padding: 5, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.elevated},
  moreItem: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 12, padding: 7},
  errorBar: {height: 25, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: palette.errorBg}, errorText: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 10},
});

const useStyles = () => useThemeStyles(makeStyles);
