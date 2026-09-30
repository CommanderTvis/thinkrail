import {SpinningIcon} from './SpinningIcon';
import {ResourcesButton, ResourcesLayer, useChatResources} from './ChatResources';
import {type ReactNode, type SetStateAction, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions, type GestureResponderEvent, type StyleProp, type ViewStyle} from 'react-native';
import {TextInput as MacTextInput, View as MacView} from 'react-native-macos';
import {activeWorkspace, hostClient, useHostClient, type BranchList, type Change, type DiffScope, type FileNode, type GitCommit, type SpecNode} from './HostClient';
import {buildChangeTree, type ChangeNode} from './changeTree';
import {ChatPickerMenu} from './ChatPickerMenu';
import {useChatMessageOrder, useStreamingMovement} from './chatPreferences';
import {projectChatRows, type ChatRow} from './chatRows';
import {ChatActivity} from './ChatActivity';
import {MessageWithCopy, ReviewFixCard, UserMessage} from './ChatMessage';
import {parseReviewFix} from './reviewPackageModel';
import {emptyPromptImages, PromptImageChips, pickPromptImages, transferPromptImages} from './PromptImageChips';
import type {PromptImageDraft} from './promptImageModel';
import {chatMessageAttachments, chatMessageText, messageActions} from './messageActionModel';
import type {ToolResults} from './chatActivityModel';
import {useChatFollow} from './useChatFollow';
import {composerInputHeight} from './composerGeometry';
import {useComposerTemplates, type PromptCommandSource} from './useComposerTemplates';
import {CompactionMessage} from './CompactionMessage';
import {compactionState} from './compactionModel';
import {replaceComposerDraftText, type ComposerDraft} from './composerDraft';
import {nameChatCommand, nameChatCommandTitle, prepareChatRename} from './nameChatCommand';
import {compactChatCommand, compactInstructions, compactSubmissionError} from './compactChatCommand';
import {recentChatPrompts, promptRecallIndex, promptRecallStep, type PromptRecallCursor} from './promptRecall';
import {ComposerSlashMenu, ComposerSlotHint} from './ComposerSlashMenu';
import {composerKeyBehavior, composerSendKeys, streamingSendModes, type SubmitBehavior} from './composerSubmission';
import {tid} from './testId';
import {Icon, type IconName} from './Icon';
import {MarkdownText} from './MarkdownText';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';

export {color} from './Theme';

const ansiSequence = new RegExp(String.fromCharCode(27) + '\\[[0-?]*[ -/]*[@-~]', 'g');

export function PanelHeader({title, detail, action, onAction}: {title: string; detail?: string; action?: string; onAction?: () => void}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <View style={s.header}>
    <Text style={s.headerTitle}>{title}</Text>
    {detail ? <Text numberOfLines={1} style={s.headerDetail}>{detail}</Text> : null}
    {action ? <Pressable onPress={onAction} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={[s.actionButton, hovered && s.actionHovered]}><Icon name="add" color={color.muted} size={14} /><Text style={s.action}>{action}</Text></Pressable> : null}
  </View>;
}

export function ListRow({label, labelNode, subtitle, icon, iconColor, spinning, chevron, selected, badge, onPress, depth = 0, style, testID, labelTestID, subtitleTestID}: {
  testID?: string; accessible?: boolean; labelTestID?: string; subtitleTestID?: string; label: string; labelNode?: ReactNode; subtitle?: string; icon?: IconName; iconColor?: string; spinning?: boolean; chevron?: IconName; selected?: boolean; badge?: string; onPress?: (event: GestureResponderEvent) => void; depth?: number; style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <Pressable testID={testID} onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[s.row, subtitle && s.rowTwoLine, hovered && !selected && s.rowHovered, selected && s.rowSelected, {paddingLeft: 10 + depth * 14}, style]}>
    {chevron ? <Icon name={chevron} color={color.muted} size={14} /> : null}
    {spinning ? <SpinningIcon name="loader" color={selected ? color.accent : color.muted} size={14} />
      : icon ? <Icon name={icon} color={iconColor ?? (selected ? color.accent : color.muted)} size={14} /> : null}
    <View style={s.rowBody}>
      {labelNode ?? <View testID={labelTestID}><Text numberOfLines={1} style={[s.rowText, selected && s.selectedText]}>{label}</Text></View>}
      {subtitle ? <View testID={subtitleTestID}><Text numberOfLines={1} style={s.rowSubtitle}>{subtitle}</Text></View> : null}
    </View>
    {badge ? <Text style={s.badge}>{badge}</Text> : null}
  </Pressable>;
}

function FileRow({node, depth, onOpenFile}: {node: FileNode; depth: number; onOpenFile: (path: string) => void}) {
  const state = useHostClient();
  const expanded = state.expanded.includes(node.path);
  return <>
    <ListRow testID={tid('file-node', {path: node.path, kind: node.kind, expanded: node.kind === 'dir' ? expanded : undefined}).testID} label={node.name} icon={node.kind === 'dir' ? expanded ? 'folderOpen' : 'folder' : 'file'} chevron={node.kind === 'dir' ? expanded ? 'arrowDown' : 'arrowRight' : undefined} depth={depth}
      selected={state.filePath === node.path} onPress={() => {
        if (node.kind === 'dir') hostClient.toggleFolder(node.path);
        else onOpenFile(node.path);
      }} />
    {expanded ? state.folders[node.path]?.map(child => <FileRow key={child.path} node={child} depth={depth + 1} onOpenFile={onOpenFile} />) : null}
  </>;
}

export function FilesPane({onOpenFile}: {onOpenFile: (path: string) => void}) {
  const s = useStyles();
  const state = useHostClient();
  return <View style={s.fill}>
    <PanelHeader title="FILES" detail={`${state.files.length}`} />
    <ScrollView style={s.fill}>
      {state.files.length ? state.files.map(node => <FileRow key={node.path} node={node} depth={0} onOpenFile={onOpenFile} />)
        : <Text style={s.empty}>Open a workspace to browse its files.</Text>}
    </ScrollView>
  </View>;
}

function MessageCard({row, results, scope, root, onOpenFile, agentResponded, isFinalAnswer}: {
  row: ChatRow; results: ToolResults; scope: string; root: string; onOpenFile: (path: string) => void; agentResponded: boolean; isFinalAnswer: boolean;
}) {
  const s = useStyles();
  const {message, streaming} = row;
  const text = chatMessageText(message);
  const compaction = compactionState(message);
  if (compaction) return <CompactionMessage id={`${scope}:${row.id}`} state={compaction} />;
  if (message.role === 'error') return <View accessibilityRole="alert" style={s.chatError}><View style={s.chatErrorIcon}><Icon name="alertWarning" size={12} color={color.red} /></View><Text selectable style={s.chatErrorText}>{text}</Text></View>;
  if (message.role === 'user') return <UserMessage id={`${scope}:${row.id}`} text={text} attachments={chatMessageAttachments(message.content)} agentResponded={agentResponded} />;
  const reviewFix = parseReviewFix(message);
  if (reviewFix) return <ReviewFixCard id={`${scope}:${row.id}`} review={reviewFix} />;
  if (message.role !== 'assistant') return <Text selectable style={s.notice}>{text || message.role}</Text>;
  return <View style={s.assistantMessage}>
    {row.activity ? <ChatActivity content={message.content} rowId={row.id} scope={scope} results={results} root={root} live={!!streaming} onOpenFile={onOpenFile} />
      : text ? isFinalAnswer ? <MessageWithCopy text={text} side="left"><View style={s.finalAnswer}>
        <MarkdownText text={text} compact trimTrailingSpace />
      </View></MessageWithCopy> : <MarkdownText text={text} compact /> : null}
    {streaming && !row.activity ? <Text style={s.streaming}>● Pi is working</Text> : null}
  </View>;
}

export function ChatPane({composerDraft, onComposerDraftChange, attachments, onAttachmentsChange, onOpenFile, onManageTemplates}: {
  composerDraft: ComposerDraft; onComposerDraftChange: (draft: SetStateAction<ComposerDraft>) => void; onOpenFile: (path: string) => void; onManageTemplates: () => void;
  attachments: PromptImageDraft; onAttachmentsChange: (images: SetStateAction<PromptImageDraft>) => void;
}) {
  const s = useStyles();
  const state = useHostClient();
  const draft = composerDraft.text;
  const [recall, setRecall] = useState<PromptRecallCursor | null>(null);
  const recallContext = JSON.stringify([state.workspaceId, state.sessionId]);
  const recentPrompts = useMemo(() => recentChatPrompts(state.messages), [state.messages]);
  const recallIndex = promptRecallIndex(recall, recallContext, draft, recentPrompts);
  if (recall && recallIndex === null) setRecall(null);
  const onDraftChange = (change: SetStateAction<string>) => {
    setRecall(null);
    onComposerDraftChange(current => replaceComposerDraftText(current, change));
  };
  const commandSource = useMemo((): PromptCommandSource => ({
    context: `${hostClient.hostURL}:${state.workspaceId}:${state.sessionId}`,
    location: state.workspaceId ? {workspaceId: state.workspaceId} : null,
    loadCommands: state.sessionId && state.connection === 'connected' ? () => hostClient.sessionCommands(state.sessionId) : null,
    builtins: [compactChatCommand, nameChatCommand],
  }), [state.workspaceId, state.sessionId, state.connection]);
  const {input: promptInput, ...templates} = useComposerTemplates(composerDraft, onComposerDraftChange, commandSource);
  const canSubmit = !templates.pending && !attachments.pending && (!!templates.finalize().trim() || attachments.images.length > 0);
  const [hovered, setHovered] = useState('');
  const [picker, setPicker] = useState<'model' | 'thinking' | null>(null);
  const [modelButton, setModelButton] = useState<View | null>(null);
  const [thinkingButton, setThinkingButton] = useState<View | null>(null);
  const [sendMenu, setSendMenu] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [composerContentHeight, setComposerContentHeight] = useState(36);
  const [chatHeight, setChatHeight] = useState(0);
  const {width: viewportWidth} = useWindowDimensions();
  const messageOrder = useChatMessageOrder();
  const movement = useStreamingMovement();
  const resources = useChatResources(state.workspaceId, state.sessionId);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const {transcript, ...follow} = useChatFollow(state.sessionId, messageOrder, state.streaming, movement);
  const chronologicalRows = useMemo(() => projectChatRows(state.messages, state.streamingMessage, 'oldest-first', state.streaming), [state.messages, state.streamingMessage, state.streaming]);
  const actions = useMemo(() => messageActions(chronologicalRows, state.streaming), [chronologicalRows, state.streaming]);
  const rows = useMemo(() => messageOrder === 'newest-first' ? [...chronologicalRows].reverse() : chronologicalRows, [chronologicalRows, messageOrder]);
  useEffect(() => setPicker(null), [state.sessionId]);
  useEffect(() => setSendMenu(false), [state.sessionId, state.streaming]);
  const composerHeight = composerInputHeight(composerContentHeight, chatHeight, state.config?.composerGrowthLimit ?? 'half-chat');
  const chatWidth = (state.config?.chatLineWidth ?? 120) * 8 + 32;
  const selected = state.sessions.find(session => session.sessionId === state.sessionId);
  const thinkingLevels = selected?.model?.thinkingLevels ?? [];
  const submit = (behavior: SubmitBehavior) => {
    if (!canSubmit || templates.isPending()) return;
    const finalized = templates.finalize();
    const instructions = compactInstructions(finalized);
    if (instructions !== null) {
      const reason = compactSubmissionError(attachments.images.length > 0, state.queue.hasImages === true);
      if (reason) {templates.setError(reason); return;}
      setSendMenu(false); onDraftChange(''); templates.setError('');
      hostClient.compactSession(state.workspaceId, state.sessionId, instructions, text => {
        onDraftChange(current => [text, current].filter(value => value.trim()).join('\n\n'));
        if (hostClient.getSnapshot().sessionId === state.sessionId) promptInput.current?.focus();
      });
      return;
    }
    const renameTitle = nameChatCommandTitle(finalized);
    if (renameTitle !== null) {
      const prepared = prepareChatRename(renameTitle, attachments.images.length > 0);
      if ('reason' in prepared) {templates.setError(prepared.reason); return;}
      setSendMenu(false);
      onDraftChange(''); templates.setError('');
      hostClient.renameSession(state.workspaceId, state.sessionId, prepared.title);
      return;
    }
    const text = finalized.trim();
    const images = attachments.images;
    setSendMenu(false);
    onDraftChange('');
    onAttachmentsChange(emptyPromptImages);
    hostClient.prompt(text, behavior, images.map(image => image.content)).then(accepted => {
      if (!accepted) {
        onDraftChange(current => [current, text].filter(Boolean).join('\n\n'));
        onAttachmentsChange(current => ({...current, images: [...images, ...current.images]}));
      }
    });
  };
  return <View style={s.fill} onLayout={event => setChatHeight(event.nativeEvent.layout.height)}>
    <View {...tid('chat-toolbar')} style={s.chatToolbar}><View style={s.chatToolbarSpacer} />
      <ResourcesButton activeCount={resources.activeCount} open={resourcesOpen} onPress={() => setResourcesOpen(!resourcesOpen)} />
      {state.stats ? <Text style={s.modelStats}>{state.stats.tokens.total.toLocaleString()} tokens · ${state.stats.cost.toFixed(3)}</Text> : null}
    </View>
    <View style={s.fill}><ScrollView ref={transcript} style={s.fill} onLayout={follow.onLayout} onScroll={follow.onScroll} scrollEventThrottle={16}
      onContentSizeChange={follow.onContentSizeChange}
      contentContainerStyle={[s.transcript, s.transcriptBounds, {maxWidth: chatWidth, paddingBottom: 16 + follow.runway}]}>
      {rows.length ? rows.map((row, index) => <View key={row.id} {...tid('chat-message', {role: row.message.role, activity: row.activity ? true : undefined})}
        onLayout={index === (messageOrder === 'newest-first' ? 0 : rows.length - 1) ? event => follow.onLatestLayout(row.id, event) : undefined}>
        <MessageCard key={`${state.sessionId}:${row.id}`} row={row} results={state.toolResults} scope={`${hostClient.hostURL}:${state.sessionId}`}
          agentResponded={actions.responded.get(row.id) ?? false} isFinalAnswer={actions.finalAnswers.has(row.id)}
          root={activeWorkspace(state)?.worktreePath ?? ''} onOpenFile={onOpenFile} /></View>)
        : <View style={s.welcome}><Text style={s.welcomeTitle}>What are we working on?</Text><Text style={s.empty}>Ask Pi about this workspace, or open a file to inspect it.</Text></View>}
    </ScrollView>
    {!follow.following ? <View pointerEvents="box-none" style={s.followDock}><Pressable accessibilityRole="button" onPress={follow.returnToLatest}
      style={[s.followButton, hovered === 'follow' && s.actionHovered]}
      onHoverIn={() => setHovered('follow')} onHoverOut={() => setHovered('')}>
      <Icon name={messageOrder === 'newest-first' ? 'arrowUp' : 'arrowDown'} color={hovered === 'follow' ? color.text : color.muted} size={12} />
      <Text style={[s.followLabel, hovered === 'follow' && s.followHovered]}>{state.streaming ? 'Follow response' : 'Latest'}</Text>
    </Pressable></View> : null}</View>
    <View style={s.composerFrame}>
      {templates.open ? <ComposerSlashMenu commands={templates.matches} activeIndex={templates.index} onSelect={templates.pick} onManageTemplates={templates.templatesEmpty ? () => {onDraftChange(''); templates.setError(''); onManageTemplates();} : undefined} /> : null}
      {templates.slots && !templates.open ? <ComposerSlotHint activeIndex={templates.slots.activeIndex} count={templates.slots.slots.length} onNext={() => templates.step(1)} /> : null}
      <PromptImageChips value={attachments} onChange={onAttachmentsChange} commandError={templates.error} />
      <View style={s.composerInset}><MacView style={[s.composer, composerFocused && s.composerFocused]}
        onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)}>
      <MacTextInput {...tid('chat-input')} ref={promptInput} multiline value={draft} onChangeText={text => {
        if (text !== draft) setRecall(null);
        templates.change(text);
      }}
        onSelectionChange={event => templates.select(event.nativeEvent.selection)}
        pastedTypes={['fileUrl', 'image']} draggedTypes={['fileUrl', 'image']}
        onPaste={event => transferPromptImages(event.nativeEvent.dataTransfer.files, onAttachmentsChange)}
        onDrop={event => transferPromptImages(event.nativeEvent.dataTransfer?.files ?? [], onAttachmentsChange)}
        keyDownEvents={[...composerSendKeys, ...((sendMenu || picker || templates.open || templates.slots) ? [{key: 'Escape'}] : []),
          ...(templates.open ? [{key: 'ArrowDown'}, {key: 'ArrowUp'}, {key: 'Tab'}] : []),
          ...(templates.open ? [{key: 'Tab', shiftKey: true}, {key: 'Enter', shiftKey: true}, {key: 'Enter', shiftKey: true, altKey: true}] : []),
          ...(!templates.open && recentPrompts.length && (draft === '' || recallIndex !== null) ? [{key: 'ArrowUp'}] : []),
          ...(!templates.open && recallIndex !== null ? [{key: 'ArrowDown'}] : []),
          ...(templates.slots ? [{key: 'Tab'}, {key: 'Tab', shiftKey: true}] : [])]}
        onKeyDown={event => {
          if (event.nativeEvent.key === 'Escape' && (sendMenu || picker)) {event.stopPropagation(); setSendMenu(false); setPicker(null); return;}
          if (templates.handleKey(event.nativeEvent)) {event.stopPropagation(); return;}
          const recalled = promptRecallStep(event.nativeEvent.key, draft, recallIndex, recentPrompts);
          if (recalled) {
            event.stopPropagation();
            setRecall(recalled.index === null ? null : {context: recallContext, index: recalled.index});
            templates.replaceText(recalled.text);
            return;
          }
          const behavior = composerKeyBehavior(event.nativeEvent, state.streaming);
          if (behavior) {event.stopPropagation(); submit(behavior);}
        }}
        placeholder={state.streaming ? 'Enter steers at the next step · Cmd/Ctrl+Enter queues for when it finishes' : 'Message… (Enter to send)'} placeholderTextColor={color.muted}
        onContentSizeChange={event => setComposerContentHeight(event.nativeEvent.contentSize.height)}
        style={[s.composerInput, {height: composerHeight}]} />
      <View style={s.composerFoot}><View style={[s.composerControls, viewportWidth >= 640 && s.composerControlsWide]}>
        <Pressable {...{enableFocusRing: true}} accessibilityRole="button" accessibilityLabel="Attach images" disabled={attachments.pending > 0} onPress={() => pickPromptImages(onAttachmentsChange)}
          onHoverIn={() => setHovered('attach')} onHoverOut={() => setHovered('')}
          style={[s.stop, attachments.pending > 0 && s.sendDisabled, hovered === 'attach' && s.actionHovered]}>
          <Icon name="fileAdd" size={16} color={color.muted} />
        </Pressable>
        <Pressable ref={setModelButton} {...tid('model-selector', {open: picker === 'model'})} {...{enableFocusRing: true}} accessibilityRole="button" accessibilityLabel="Select model" accessibilityState={{expanded: picker === 'model'}} onPress={() => setPicker(picker === 'model' ? null : 'model')}
          onHoverIn={() => setHovered('model')} onHoverOut={() => setHovered('')} style={[s.modelButton, viewportWidth >= 640 ? s.modelWide : s.modelNarrow, hovered === 'model' && s.actionHovered, picker === 'model' && s.modelOpen]}>
          <Text numberOfLines={1} style={s.modelText}>{selected?.model?.name ?? 'Select model'}</Text><Icon name="arrowDown" color={color.muted} size={16} />
        </Pressable>
        <Pressable ref={setThinkingButton} {...tid('thinking-selector', {open: picker === 'thinking', disabled: !thinkingLevels.length})} {...{enableFocusRing: true}} accessibilityRole="button" accessibilityLabel="Select thinking level" accessibilityState={{expanded: picker === 'thinking', disabled: !thinkingLevels.length}} disabled={!thinkingLevels.length}
          onPress={() => setPicker(picker === 'thinking' ? null : 'thinking')}
          onHoverIn={() => setHovered('thinking')} onHoverOut={() => setHovered('')}
          style={[s.modelButton, hovered === 'thinking' && s.actionHovered, picker === 'thinking' && s.modelOpen, !thinkingLevels.length && s.modelDisabled]}>
          <Text style={[s.thinkingText, !thinkingLevels.length && s.thinkingDisabled]}>{selected?.thinkingLevel ?? 'off'}</Text><Icon name="arrowDown" color={color.muted} size={16} />
        </Pressable>
      </View><View style={s.composerActions}>
        {state.streaming ? <>
          <Pressable {...{enableFocusRing: true}} accessibilityRole="button" accessibilityLabel="Stop Pi" onPress={() => hostClient.abortSession()} style={[s.stop, hovered === 'stop' && s.actionHovered]}
            onHoverIn={() => setHovered('stop')} onHoverOut={() => setHovered('')}>
            <Icon name="stop" color={color.text} size={16} /></Pressable>
          <Pressable {...{enableFocusRing: true}} accessibilityRole="button" accessibilityLabel="Send options" accessibilityState={{expanded: sendMenu}} onPress={() => {setPicker(null); setSendMenu(!sendMenu);}}
            onHoverIn={() => setHovered('sendOptions')} onHoverOut={() => setHovered('')}
            style={[s.stop, hovered === 'sendOptions' && s.actionHovered]}><View style={s.sendOptionsGlyph}><Icon name="arrowDown" color={color.text} size={16} /></View></Pressable>
        </> : null}
        <Pressable {...{enableFocusRing: true}} accessibilityRole="button" accessibilityLabel={state.streaming ? 'Steer Pi' : 'Send message'} accessibilityState={{disabled: !canSubmit}} disabled={!canSubmit}
          style={[s.send, hovered === 'send' && s.sendHovered, !canSubmit && s.sendInactive]}
          onHoverIn={() => setHovered('send')} onHoverOut={() => setHovered('')}
          onPress={() => submit(state.streaming ? 'steer' : 'send')}>
          <Icon name="arrowUp" color={canSubmit ? color.onAccent : color.primaryDisabledText} size={16} />
        </Pressable>
      </View>
      </View>
      </MacView></View>
    </View>
    {sendMenu && state.streaming ? <MacView style={s.sendMenuLayer} keyDownEvents={[{key: 'Escape'}]}
      onKeyDown={event => {if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); setSendMenu(false);}}}>
      <Pressable accessibilityLabel="Dismiss send options" style={StyleSheet.absoluteFill} onPress={() => setSendMenu(false)} />
      <View style={s.sendMenu}>{streamingSendModes.map(mode => <Pressable key={mode.behavior} accessibilityRole="menuitem"
        disabled={!canSubmit} onPress={() => submit(mode.behavior)}
        onHoverIn={() => setHovered(mode.behavior)} onHoverOut={() => setHovered('')}
        style={[s.sendMenuRow, hovered === mode.behavior && s.actionHovered, !canSubmit && s.sendDisabled]}>
        <View style={s.sendMenuHeading}><Text style={s.sendMenuLabel}>{mode.name}</Text><Text style={s.sendMenuDetail}>{mode.keys}</Text></View>
        <Text style={s.sendMenuDetail}>{mode.meaning}</Text>
      </Pressable>)}</View>
    </MacView> : null}
    <ResourcesLayer resources={resources} open={resourcesOpen} onClose={() => setResourcesOpen(false)} />
    {picker ? <ChatPickerMenu key={picker} kind={picker} anchor={picker === 'model' ? modelButton : thinkingButton} models={state.models} currentModel={selected?.model}
      levels={thinkingLevels} currentLevel={selected?.thinkingLevel ?? 'off'} onDismiss={() => setPicker(null)}
      onSelectModel={model => {setPicker(null); hostClient.setModel(model);}}
      onSelectThinking={level => {setPicker(null); hostClient.setThinkingLevel(level);}} /> : null}
  </View>;
}

export function EditorPane({onOpenFile}: {onOpenFile: (path: string) => void}) {
  const s = useStyles();
  const state = useHostClient();
  const preview = useRef<ScrollView>(null);
  const markdown = /\.md(?:own)?$/i.test(state.filePath);
  const [source, setSource] = useState(false);
  const [hoveredView, setHoveredView] = useState('');
  useEffect(() => setSource(false), [state.filePath]);
  const lines = state.fileContent.split('\n').slice(0, 500);
  return <View style={s.fill}>
    <View style={s.fileHeader}>
      <Text numberOfLines={1} style={s.headerTitle}>{state.filePath.split('/').at(-1) ?? 'EDITOR'}</Text>
      <Text numberOfLines={1} style={s.headerDetail}>{state.filePath}</Text>
      {markdown ? <View style={s.viewModes}>{(['Preview', 'Source'] as const).map(mode => {
        const active = mode === 'Source' ? source : !source;
        return <Pressable key={mode} onPress={() => setSource(mode === 'Source')}
          onHoverIn={() => setHoveredView(mode)} onHoverOut={() => setHoveredView('')}
          style={[s.viewMode, hoveredView === mode && s.viewModeHovered, active && s.viewModeActive]}>
          <Text style={[s.viewModeText, active && s.viewModeTextActive]}>{mode}</Text>
        </Pressable>;
      })}</View> : null}
    </View>
    {markdown && !source ? <ScrollView ref={preview} style={s.fill} contentContainerStyle={s.markdownDocument}>
      <MarkdownText text={state.fileContent} path={state.filePath} onOpenFile={onOpenFile}
        onScrollTo={y => preview.current?.scrollTo({y: y + 16, animated: true})} />
    </ScrollView> : <ScrollView style={s.fill} contentContainerStyle={s.editorBody}>
      {state.filePath ? lines.map((line, index) => <View key={index} style={s.codeLine}>
        <Text style={s.lineNumber}>{index + 1}</Text><Text style={s.code}>{line || ' '}</Text>
      </View>) : <Text style={s.empty}>Select a file from the sidebar.</Text>}
    </ScrollView>}
  </View>;
}

function ChangeStat({added, removed}: {added?: number; removed?: number}) {
  const s = useStyles();
  return <View style={s.changeStat}><Text style={s.changeAdded}>+{added ?? 0}</Text><Text style={s.changeRemoved}>−{removed ?? 0}</Text></View>;
}

function ChangeFileRow({change, name, directory, depth, selected, onPress}: {
  change: Change; name: string; directory?: string; depth: number; selected: boolean; onPress: () => void;
}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  const nameColor = change.status === 'deleted' ? color.red : change.status === 'added' || change.status === 'untracked' ? color.accent : color.muted;
  return <Pressable onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[s.changeRow, {paddingLeft: 12 + depth * 14}, hovered && s.changesHover, selected && s.rowSelected]}>
    {directory === undefined ? <Icon name="fileDiff" color={color.muted} size={14} /> : null}
    <View style={s.changePath}>{directory ? <Text numberOfLines={1} style={s.changeDir}>{directory}</Text> : null}
      <Text numberOfLines={1} style={[s.changeName, {color: nameColor}]}>{name}</Text></View>
    <ChangeStat added={change.added} removed={change.removed} />
  </Pressable>;
}

function ChangeTreeRow({node, depth, selected, onOpen}: {node: ChangeNode; depth: number; selected: string; onOpen: (path: string) => void}) {
  const s = useStyles();
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  if (node.kind === 'file') return <ChangeFileRow change={node.change} name={node.name} depth={depth}
    selected={selected === node.path} onPress={() => onOpen(node.path)} />;
  return <>
    <Pressable onPress={() => setExpanded(!expanded)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={[s.changeRow, {paddingLeft: 12 + depth * 14}, hovered && s.changesHover]}>
      <Icon name={expanded ? 'arrowDown' : 'arrowRight'} color={color.muted} size={14} />
      <Icon name={expanded ? 'folderOpen' : 'folder'} color={color.muted} size={14} />
      <Text numberOfLines={1} style={s.changeFolder}>{node.name}</Text>
      <ChangeStat added={node.added} removed={node.removed} />
    </Pressable>
    {expanded ? node.children.map(child => <ChangeTreeRow key={child.path} node={child} depth={depth + 1} selected={selected} onOpen={onOpen} />) : null}
  </>;
}

function ChangeMenuItem({label, onPress}: {label: string; onPress: () => void}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <Pressable onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[s.changesMenuRow, hovered && s.changesHover]}><Text numberOfLines={1} style={s.changeName}>{label}</Text></Pressable>;
}

export function ChangesPane({onOpenDiff}: {onOpenDiff: (path: string, scope: DiffScope) => void}) {
  const s = useStyles();
  const state = useHostClient();
  const [view, setView] = useState<'list' | 'tree'>('list');
  const [menu, setMenu] = useState<'scope' | 'base' | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>();
  const [branches, setBranches] = useState<BranchList>();
  const [error, setError] = useState('');
  const [hoveredControl, setHoveredControl] = useState('');
  const workspace = activeWorkspace(state);
  useEffect(() => {setMenu(null); setError('');}, [state.workspaceId]);
  const openMenu = (kind: 'scope' | 'base') => {
    if (menu === kind) {setMenu(null); return;}
    setMenu(kind);
    if (kind === 'scope' && state.workspaceId) {setCommits(undefined); hostClient.listCommits(state.workspaceId).then(result => setCommits(result.commits)).catch(reason => setError(String(reason)));}
    if (kind === 'base' && workspace) {setBranches(undefined); hostClient.listBranches(workspace.projectId).then(setBranches).catch(reason => setError(String(reason)));}
  };
  const chooseScope = (scope: DiffScope) => {
    setMenu(null); setError('');
    hostClient.setDiffScope(scope).catch(reason => setError(String(reason)));
  };
  const chooseBase = (ref: string) => {
    setMenu(null); setError('');
    if (workspace) hostClient.setDiffBase(workspace.id, ref).catch(reason => setError(String(reason)));
  };
  const openDiff = (path: string) => onOpenDiff(path, state.diffScope);
  const scopeLabel = state.diffScope.kind === 'branch' ? 'All changes' : state.diffScope.kind === 'uncommitted' ? 'Uncommitted' : state.diffScope.sha.slice(0, 7);
  return <View style={s.fill}>
    <View style={s.changesToolbar}>
      <Pressable style={[s.changesTrigger, hoveredControl === 'scope' && s.changesHover]} onPress={() => openMenu('scope')}
        onHoverIn={() => setHoveredControl('scope')} onHoverOut={() => setHoveredControl('')}><Icon name="gitBranch" color={color.muted} size={14} />
        <Text numberOfLines={1} style={s.changesTriggerText}>{scopeLabel}</Text><Icon name="arrowDown" color={color.muted} size={13} /></Pressable>
      <Pressable style={[s.changesTrigger, hoveredControl === 'base' && s.changesHover]} onPress={() => openMenu('base')}
        onHoverIn={() => setHoveredControl('base')} onHoverOut={() => setHoveredControl('')}><Icon name="gitBranch" color={color.muted} size={14} />
        <Text numberOfLines={1} style={s.changesTriggerText}>vs {workspace?.diffBase ?? workspace?.baseBranch ?? workspace?.branch ?? 'branch'}</Text><Icon name="arrowDown" color={color.muted} size={13} /></Pressable>
      <View style={s.changesSpacer} />
      {(['list', 'tree'] as const).map(mode => <Pressable key={mode} onPress={() => setView(mode)}
        onHoverIn={() => setHoveredControl(mode)} onHoverOut={() => setHoveredControl('')}
        style={[s.changeView, hoveredControl === mode && s.changesHover, view === mode && s.changeViewActive]}>
        <Text style={[s.changeViewText, view === mode && s.changeViewTextActive]}>{mode === 'list' ? 'List' : 'Tree'}</Text></Pressable>)}
    </View>
    {error ? <Text style={s.changeError}>{error}</Text> : null}
    <ScrollView style={s.fill} contentContainerStyle={s.changesList}>
      {view === 'list' ? state.changes.map(change => {
        const cut = change.path.lastIndexOf('/');
        return <ChangeFileRow key={change.path} change={change} name={change.path.slice(cut + 1)} directory={cut < 0 ? '' : change.path.slice(0, cut + 1)} depth={0}
          selected={state.diffPath === change.path} onPress={() => openDiff(change.path)} />;
      }) : buildChangeTree(state.changes).map(node => <ChangeTreeRow key={node.path} node={node} depth={0} selected={state.diffPath} onOpen={openDiff} />)}
      {!state.changes.length ? <View {...tid('changes-empty')}><Text style={s.empty}>No changes in this scope.</Text></View> : null}
    </ScrollView>
    {menu ? <View style={s.changesMenu}><ScrollView style={s.changesMenuScroll}>
      {menu === 'scope' ? <>
        <ChangeMenuItem label="All changes" onPress={() => chooseScope({kind: 'branch'})} />
        <ChangeMenuItem label="Uncommitted changes" onPress={() => chooseScope({kind: 'uncommitted'})} />
        <Text style={s.changesMenuHeading}>COMMITS</Text>
        {commits ? commits.length ? commits.map(commit => <ChangeMenuItem key={commit.sha} label={`${commit.shortSha} · ${commit.subject}`}
          onPress={() => chooseScope({kind: 'commit', sha: commit.sha})} />) : <Text style={s.empty}>No commits on this branch.</Text>
          : <Text style={s.empty}>Loading commits…</Text>}
      </> : <>
        <Text style={s.changesMenuHeading}>BRANCHES</Text>
        {branches ? [...new Set([...branches.local, ...branches.remote])].map(ref => <ChangeMenuItem key={ref} label={ref} onPress={() => chooseBase(ref)} />)
          : <Text style={s.empty}>Loading branches…</Text>}
      </>}
    </ScrollView></View> : null}
  </View>;
}

export function DiffPane() {
  const s = useStyles();
  const state = useHostClient();
  return <View style={s.fill}>
    <PanelHeader title="DIFF" detail={state.diffPath} />
    <ScrollView style={s.fill} contentContainerStyle={s.editorBody}>
      {state.diffPath ? <View style={s.diffColumns}>
        <View style={s.diffColumn}><Text style={s.blockLabel}>BEFORE</Text><Text style={s.code}>{state.diffOriginal.slice(0, 20000)}</Text></View>
        <View style={s.diffColumn}><Text style={s.blockLabel}>AFTER</Text><Text style={s.code}>{state.diffModified.slice(0, 20000)}</Text></View>
      </View> : <Text style={s.empty}>Select a changed file to inspect its diff.</Text>}
    </ScrollView>
  </View>;
}

export function TerminalPane({tabKey}: {tabKey: string}) {
  const s = useStyles();
  const state = useHostClient();
  const [input, setInput] = useState('');
  const terminal = state.terminalInstances[tabKey];
  const title = state.terminalTabs.find(tab => tab.tabKey === tabKey)?.title ?? 'Terminal';
  return <View {...tid('terminal-instance', {'tab-key': tabKey, visible: true, ready: terminal !== undefined})} style={s.fill}>
    <PanelHeader title="TERMINAL" detail={title} />
    <ScrollView style={s.fill} contentContainerStyle={s.terminalBody}><View {...tid('terminal-screen')}><Text style={s.code}>{terminal?.output.replace(ansiSequence, '') || (terminal ? 'Waiting for shell output…' : 'Attaching terminal…')}</Text></View></ScrollView>
    <TextInput {...tid('terminal-input')} value={input} onChangeText={setInput} onSubmitEditing={() => {hostClient.writeTerminal(tabKey, `${input}\n`); setInput('');}}
      placeholder={terminal ? 'Type a shell command and press Return' : 'Attaching terminal…'} placeholderTextColor={color.muted} style={s.terminalInput} />
  </View>;
}

type SpecBranch = {node: SpecNode; children: SpecBranch[]};
const specTags: Record<string, string> = {
  'goal-and-requirements': 'GOAL', 'architecture-design': 'ARCH', 'module-design': 'MODULE',
  'submodule-design': 'SUBMODULE', 'task-spec': 'TASK',
};

function SpecRow({branch, depth, onOpenFile}: {branch: SpecBranch; depth: number; onOpenFile: (path: string) => void}) {
  const s = useStyles();
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const {node, children} = branch;
  const icon: IconName = node.type === 'goal-and-requirements' ? 'bookFill' : node.type === 'architecture-design' ? 'network'
    : node.type === 'module-design' ? 'box' : node.type === 'submodule-design' ? 'stack' : node.type === 'task-spec' ? 'list' : 'fileText';
  const tag = depth === 0 && node.type === 'goal-and-requirements' ? 'MAIN SPEC' : specTags[node.type] ?? node.type.replace(/[-_]+/g, ' ').toUpperCase();
  return <>
    <Pressable onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      onPress={() => onOpenFile(node.path)}
      style={[s.specRow, hovered && s.specRowHovered, {paddingLeft: 16 + depth * 14}]}>
      {children.length ? <TouchableOpacity onPress={event => {event.stopPropagation(); setExpanded(!expanded);}} style={s.specChevron}><Icon name={expanded ? 'arrowDown' : 'arrowRight'} color={color.muted} size={14} /></TouchableOpacity> : <View style={s.specChevron} />}
      <View style={s.specLink}>
        <Icon name={icon} color={node.type === 'goal-and-requirements' ? color.accent : color.muted} size={14} /><Text style={[s.specText, hovered && s.specTextHovered]} numberOfLines={1}>{node.title.replace(/\s+[—–]\s+/g, ' · ')}</Text>
      </View>
      {hovered ? <Text style={[s.specRole, node.type === 'goal-and-requirements' && s.specRoleMain]}>{tag}</Text> : null}
    </Pressable>
    {expanded ? children.map(child => <SpecRow key={child.node.id} branch={child} depth={depth + 1} onOpenFile={onOpenFile} />) : null}
  </>;
}

export function SpecsPane({onOpenFile}: {onOpenFile: (path: string) => void}) {
  const s = useStyles();
  const state = useHostClient();
  const roots = useMemo(() => {
    const ids = new Set(state.specs.map(node => node.id));
    const children = new Map<string, SpecNode[]>();
    const rootNodes: SpecNode[] = [];
    for (const node of state.specs) {
      if (node.parent && ids.has(node.parent) && node.parent !== node.id) {
        const siblings = children.get(node.parent) ?? [];
        siblings.push(node);
        children.set(node.parent, siblings);
      } else rootNodes.push(node);
    }
    const byTitle = (a: SpecNode, b: SpecNode) => a.title.localeCompare(b.title);
    rootNodes.sort(byTitle);
    for (const siblings of children.values()) siblings.sort(byTitle);
    const visited = new Set<string>();
    const branch = (node: SpecNode): SpecBranch => {
      visited.add(node.id);
      return {node, children: (children.get(node.id) ?? []).filter(child => !visited.has(child.id)).map(branch)};
    };
    return rootNodes.map(branch);
  }, [state.specs]);
  return <ScrollView style={s.fill} contentContainerStyle={s.specList}>
    {roots.map(branch => <SpecRow key={branch.node.id} branch={branch} depth={0} onOpenFile={onOpenFile} />)}
    {!state.specs.length ? <Text style={s.empty}>No specs in this workspace.</Text> : null}
  </ScrollView>;
}

export function ReviewPane() {
  const s = useStyles();
  const state = useHostClient();
  return <ScrollView style={s.fill}>
    {state.reviews.map(review => <ListRow key={review.id} label={review.body} subtitle={review.status} icon="discuss" />)}
    {!state.reviews.length ? <Text style={s.empty}>No review comments.</Text> : null}
  </ScrollView>;
}

export function TasksPane() {
  const s = useStyles();
  const state = useHostClient();
  return <ScrollView style={s.fill}>
    {state.todos.map(todo => <ListRow key={todo.id} label={todo.title} icon={todo.status === 'done' ? 'check' : 'circle'} subtitle={todo.status} />)}
    {!state.todos.length ? <Text style={s.empty}>No plan yet.</Text> : null}
  </ScrollView>;
}

export function SkillsPane() {
  const s = useStyles();
  const state = useHostClient();
  return <ScrollView style={s.fill}>
    {state.skills.map(skill => <ListRow key={skill.name} label={skill.name} subtitle={skill.decision} icon="sparkle" />)}
    {!state.skills.length ? <Text style={s.empty}>No skills available.</Text> : null}
  </ScrollView>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  fill: {flex: 1}, header: {height: 32, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.sidebar, borderBottomWidth: 1, borderColor: palette.border},
  fileHeader: {height: 32, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.sidebar, borderBottomWidth: 1, borderColor: palette.border},
  viewModes: {flexDirection: 'row', borderWidth: 1, borderColor: palette.border, borderRadius: 4},
  viewMode: {paddingHorizontal: 9, paddingVertical: 4}, viewModeHovered: {backgroundColor: palette.hover}, viewModeActive: {backgroundColor: palette.hover},
  viewModeText: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 10}, viewModeTextActive: {color: palette.text},
  markdownDocument: {width: '100%', maxWidth: 860, alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 16},
  headerTitle: {fontFamily: 'Geist', color: palette.text, fontSize: 12, fontWeight: '600'}, headerDetail: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 10, flex: 1}, actionButton: {flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4, borderRadius: 3}, actionHovered: {backgroundColor: palette.hover}, action: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 11},
  row: {minHeight: 30, paddingRight: 9, flexDirection: 'row', alignItems: 'center', gap: 6}, rowTwoLine: {minHeight: 40, paddingVertical: 4}, rowHovered: {backgroundColor: palette.hover, borderRadius: 4}, rowSelected: {backgroundColor: palette.hover, borderRadius: 4},
  rowBody: {flex: 1, minWidth: 0}, rowText: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 14}, selectedText: {fontFamily: 'Geist Native Text', color: palette.accent, fontSize: 14},
  specList: {paddingTop: 10}, specRow: {height: 28, flexDirection: 'row', alignItems: 'center', paddingRight: 8}, specRowHovered: {backgroundColor: palette.hover, borderRadius: 4}, specText: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 14, flexShrink: 1}, specTextHovered: {color: palette.text}, specRole: {fontFamily: 'Geist Medium', color: palette.hint, fontSize: 12}, specRoleMain: {color: palette.accent}, specChevron: {width: 16},
  specLink: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6},
  rowSubtitle: {fontFamily: 'Geist Native Text', color: palette.hint, fontSize: 12}, badge: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12}, empty: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12, padding: 13},
  changesToolbar: {height: 32, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: palette.border},
  changesTrigger: {minWidth: 0, maxWidth: 160, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 4},
  changesTriggerText: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12, flexShrink: 1}, changesSpacer: {flex: 1},
  changesHover: {backgroundColor: palette.hover, borderRadius: 3},
  changeView: {paddingHorizontal: 6, paddingVertical: 4, borderRadius: 3}, changeViewActive: {backgroundColor: palette.hover},
  changeViewText: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12}, changeViewTextActive: {color: palette.text},
  changesList: {paddingHorizontal: 10, paddingVertical: 12}, changeRow: {minHeight: 28, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 5},
  changePath: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline'}, changeDir: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 14, flexShrink: 1},
  changeName: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 14, flexShrink: 1}, changeFolder: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 14, flex: 1},
  changeStat: {flexDirection: 'row', gap: 2, marginLeft: 'auto'}, changeAdded: {fontFamily: 'Geist Native Text', color: palette.success, fontSize: 12}, changeRemoved: {fontFamily: 'Geist Native Text', color: palette.red, fontSize: 12},
  changesMenu: {position: 'absolute', top: 32, left: 10, width: 280, maxWidth: '90%', maxHeight: 240, zIndex: 5, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.border, borderRadius: 4},
  changesMenuScroll: {maxHeight: 238}, changesMenuRow: {paddingHorizontal: 12, paddingVertical: 8}, changesMenuHeading: {fontFamily: 'Geist Native Text', color: palette.hint, fontSize: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 3},
  changeError: {fontFamily: 'Geist Native Text', color: palette.red, fontSize: 11, paddingHorizontal: 12, paddingVertical: 6},
  transcript: {padding: 16, gap: 12},
  followDock: {position: 'absolute', bottom: 12, left: 0, right: 0, alignItems: 'center'},
  followButton: {flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: palette.border, borderRadius: 4, backgroundColor: palette.elevated},
  followLabel: {fontFamily: 'Geist Native Text', fontSize: 12, color: palette.muted}, followHovered: {color: palette.text},
  transcriptBounds: {alignSelf: 'center', width: '100%'},
  chatToolbar: {height: 32, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.content},
  chatToolbarSpacer: {flex: 1}, modelStats: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 10},
  finalAnswer: {width: '100%', paddingLeft: 24},
  chatError: {flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, borderWidth: 1, borderColor: `${palette.red}66`, backgroundColor: `${palette.red}1f`},
  chatErrorIcon: {marginTop: 2},
  chatErrorText: {flex: 1, fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.red},
  assistantMessage: {width: '100%'}, notice: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 11, textAlign: 'center'},
  streaming: {fontFamily: 'Geist Native Text', color: palette.warning, fontSize: 10},
  blockLabel: {fontFamily: 'Geist', color: palette.muted, fontSize: 9, fontWeight: '700', marginBottom: 5},
  welcome: {alignItems: 'center', padding: 30}, welcomeTitle: {fontFamily: 'Geist', color: palette.text, fontSize: 16, fontWeight: '600'},
  composerFrame: {borderTopWidth: 1, borderColor: palette.border, backgroundColor: palette.bg}, composerInset: {padding: 12},
  composer: {borderWidth: 1, borderColor: palette.border, borderRadius: 6, backgroundColor: palette.input, padding: 4, gap: 4},
  composerFocused: {borderColor: palette.borderStrong},
  composerInput: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 14, lineHeight: 20, paddingHorizontal: 12, paddingVertical: 8},
  composerFoot: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4}, composerControls: {flexDirection: 'row', alignItems: 'center', minWidth: 0, flex: 1, gap: 4}, composerControlsWide: {gap: 8}, composerActions: {flexDirection: 'row', gap: 4},
  modelButton: {height: 32, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, borderWidth: 1, borderColor: palette.border, borderRadius: 4, backgroundColor: palette.input}, modelOpen: {borderColor: palette.borderStrong, backgroundColor: palette.hover}, modelDisabled: {borderColor: `${palette.border}99`, backgroundColor: `${palette.input}99`},
  modelText: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12, lineHeight: 16, flexShrink: 1},
  modelWide: {maxWidth: 144}, modelNarrow: {maxWidth: 80},
  thinkingText: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 14, lineHeight: 20, textTransform: 'capitalize'}, thinkingDisabled: {color: palette.disabledText},
  stop: {width: 32, height: 32, borderRadius: 4, borderWidth: 1, borderColor: palette.borderStrong, backgroundColor: palette.elevated, alignItems: 'center', justifyContent: 'center'},
  sendOptionsGlyph: {transform: [{rotate: '180deg'}]},
  sendMenuLayer: {...StyleSheet.absoluteFillObject, zIndex: 10},
  sendMenu: {position: 'absolute', right: 16, bottom: 52, width: 320, padding: 4, gap: 2, borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 6, backgroundColor: palette.elevated},
  sendMenuRow: {paddingHorizontal: 8, paddingVertical: 4, gap: 2, borderRadius: 4},
  sendMenuHeading: {flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8},
  sendMenuLabel: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.text},
  sendMenuDetail: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.muted},
  send: {width: 32, height: 32, borderRadius: 4, backgroundColor: palette.accentSolid, alignItems: 'center', justifyContent: 'center'}, sendDisabled: {opacity: 0.5}, sendHovered: {backgroundColor: palette.accentHover}, sendInactive: {backgroundColor: palette.primaryDisabledBg},
  editorBody: {padding: 10}, codeLine: {flexDirection: 'row', minHeight: 18}, lineNumber: {color: palette.muted, width: 38, textAlign: 'right', marginRight: 12, fontFamily: 'JetBrains Mono', fontSize: 10},
  code: {color: palette.text, fontFamily: 'JetBrains Mono', fontSize: 10, lineHeight: 17}, diffColumns: {flexDirection: 'row'}, diffColumn: {width: '50%', padding: 8, borderRightWidth: 1, borderColor: palette.border},
  terminalBody: {padding: 8}, terminalInput: {height: 26, color: palette.text, fontFamily: 'JetBrains Mono', fontSize: 10, borderTopWidth: 1, borderColor: palette.border, paddingHorizontal: 8},
});

const useStyles = () => useThemeStyles(makeStyles);
