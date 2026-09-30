import {useCallback, useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View, type View as NativeView} from 'react-native';
import {TextInput as MacTextInput, View as MacView} from 'react-native-macos';
import {BranchPicker} from './BranchPicker';
import {ChatPickerMenu} from './ChatPickerMenu';
import {emptyComposerDraft, type ComposerDraft} from './composerDraft';
import {ComposerSlashMenu, ComposerSlotHint} from './ComposerSlashMenu';
import {type BranchList, hostClient, type Model, useHostClient} from './HostClient';
import {Icon, type IconName} from './Icon';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {tid} from './testId';
import {toast} from './toast';
import {type PromptCommandSource, useComposerTemplates} from './useComposerTemplates';
import {emptyPromptImages, PromptImageChips, transferPromptImages} from './PromptImageChips';
import type {PromptImageDraft} from './promptImageModel';

type Target = 'worktree' | 'default';

function TargetOption({icon, label, active, testId, onPress}: {icon: IconName; label: string; active: boolean; testId: string; onPress: () => void}) {
  const s = useStyles();
  return <Pressable {...tid(testId, {active})} accessibilityRole="radio" accessibilityState={{checked: active}} onPress={onPress}
    style={[s.targetOption, active && s.targetActive]}>
    <Icon name={icon} color={active ? color.accent : color.muted} size={14} />
    <Text style={[s.targetLabel, active && s.targetLabelActive]}>{label}</Text>
  </Pressable>;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function NewWorkspaceDialog({projectId, initialPrompt, promptNote, onClose, onChatStarted}: {
  projectId: string; initialPrompt: string; promptNote?: string; onClose: () => void; onChatStarted: (sessionId: string) => void;
}) {
  const s = useStyles();
  const {projects, models} = useHostClient();
  const [target, setTarget] = useState<Target>('worktree');
  const [draft, setDraft] = useState<ComposerDraft>({...emptyComposerDraft, text: initialPrompt});
  const [creating, setCreating] = useState(false);
  const [branches, setBranches] = useState<BranchList | null>(null);
  const [refreshingBranches, setRefreshingBranches] = useState(false);
  const [baseRef, setBaseRef] = useState('');
  const [aliasSkills, setAliasSkills] = useState<string[]>([]);
  const [trustRevision, setTrustRevision] = useState(0);
  const [trusting, setTrusting] = useState(false);
  const [model, setModel] = useState<Model | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState('medium');
  const [picker, setPicker] = useState<'model' | 'thinking' | null>(null);
  const [images, setImages] = useState<PromptImageDraft>(emptyPromptImages);
  const [modelButton, setModelButton] = useState<NativeView | null>(null);
  const [thinkingButton, setThinkingButton] = useState<NativeView | null>(null);
  const isolated = target === 'worktree';
  const project = projects.find(item => item.id === projectId);

  const source = useMemo((): PromptCommandSource => ({
    context: `new-workspace:${projectId}:${trustRevision}`,
    location: {projectId},
    loadCommands: () => hostClient.listSkillCommands(projectId),
    builtins: [],
  }), [projectId, trustRevision]);
  const {input: promptInput, ...templates} = useComposerTemplates(draft, setDraft, source);

  const prefetch = useCallback((ref: string) => {
    if (ref) hostClient.prefetchRef(projectId, ref).catch(() => {});
  }, [projectId]);
  const refreshBranches = useCallback(() => {
    setRefreshingBranches(true);
    hostClient.listBranches(projectId).then(list => {
      setBranches(list);
      setBaseRef(current => {
        if (current) return current;
        prefetch(list.defaultBranch);
        return list.defaultBranch;
      });
    }).catch(() => {}).finally(() => setRefreshingBranches(false));
  }, [projectId, prefetch]);
  useEffect(refreshBranches, [refreshBranches]);
  useEffect(() => {
    let current = true;
    hostClient.projectAliasSkills(projectId).then(names => {if (current) setAliasSkills(names);}).catch(() => {});
    return () => {current = false;};
  }, [projectId]);
  useEffect(() => {
    let current = true;
    hostClient.defaultModel().then(result => {
      if (!current) return;
      setModel(result.model);
      setThinkingLevel(result.thinkingLevel);
    }).catch(() => {});
    return () => {current = false;};
  }, []);
  useEffect(() => {if (!projects.some(item => item.id === projectId)) onClose();}, [projects, projectId, onClose]);

  const selectBaseRef = (ref: string) => {
    setBaseRef(ref);
    if (branches?.remote.includes(ref)) prefetch(ref);
  };
  const trust = async () => {
    if (trusting) return;
    setTrusting(true);
    try {
      await hostClient.trustProject(projectId);
      setTrustRevision(revision => revision + 1);
    } catch (error) {
      toast.error(errorText(error), "Couldn't trust project");
    } finally {
      setTrusting(false);
    }
  };
  const submitEnabled = !creating && !templates.pending && images.pending === 0;
  const create = async () => {
    if (!submitEnabled || templates.isPending()) return;
    setCreating(true);
    const text = templates.finalize().trim();
    try {
      if (isolated) await hostClient.createWorktree(projectId, baseRef);
      else await hostClient.enterDefaultWorkspace(projectId);
    } catch (error) {
      toast.error(errorText(error), "Couldn't create workspace");
      setCreating(false);
      return;
    }
    onClose();
    const sessionId = await hostClient.createSession(model ? {model, thinkingLevel} : {});
    if (!sessionId) return;
    onChatStarted(sessionId);
    const attachments = images.images.map(image => image.content);
    if (text || attachments.length) await hostClient.prompt(text, 'send', attachments);
  };
  const levels = model?.thinkingLevels ?? [];

  return <MacView style={s.layer} keyDownEvents={[{key: 'Escape'}]}
    onKeyDown={event => {if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); onClose();}}}>
    <Pressable style={s.backdrop} onPress={onClose} />
    <View {...tid('new-workspace-dialog')} style={s.dialog}>
      <Text accessibilityRole="header" style={s.title}>{isolated ? 'Create workspace' : 'Work in project folder'}</Text>
      <Text style={s.description}>{isolated
        ? 'A separate checkout on its own new branch. Files, chats, changes, and terminals stay scoped to it.'
        : 'Runs directly in your project folder — no isolation. Changes land on the current branch.'}</Text>
      <View {...tid('ws-target')} style={s.target}>
        <TargetOption icon="gitBranch" label="Isolated workspace" active={isolated} testId="ws-target-worktree" onPress={() => setTarget('worktree')} />
        <TargetOption icon="home" label="Project folder" active={!isolated} testId="ws-target-default" onPress={() => setTarget('default')} />
      </View>
      <View style={s.row}>
        <View {...tid('ws-project-picker')} style={s.pill}>
          <Icon name="box" color={color.muted} size={14} />
          <Text numberOfLines={1} style={s.pillText}>{project?.name ?? 'Project'}</Text>
        </View>
        {isolated ? <BranchPicker branches={branches} selected={baseRef} label="From" testId="ws-branch-picker"
          refreshing={refreshingBranches} onSelect={selectBaseRef} onRefresh={refreshBranches} /> : null}
      </View>
      {project && project.trusted !== true && aliasSkills.length > 0 ? <View {...tid('ws-trust-notice')} style={s.trust}>
        <Icon name="alertWarning" color={color.warning} size={16} />
        <Text style={s.trustText}>This project ships {aliasSkills.length} skill{aliasSkills.length === 1 ? '' : 's'} — off until you trust it. Your personal and ThinkRail's built-in skills are unaffected.</Text>
        <Pressable {...tid('ws-trust-project')} accessibilityRole="button" disabled={trusting} onPress={trust} style={s.trustButton}>
          <Text style={s.trustButtonText}>Trust project</Text>
        </Pressable>
      </View> : null}
      <View style={s.promptArea}>
        {promptNote ? <View {...tid('ws-prompt-note')} style={s.note}>
          <Icon name="sparkle" color={color.accent} size={14} />
          <Text style={s.noteText}>{promptNote}</Text>
        </View> : null}
        <PromptImageChips value={images} onChange={setImages} />
        <MacTextInput {...tid('ws-prompt')} ref={promptInput} value={draft.text} editable={!creating} multiline autoFocus
          pastedTypes={['fileUrl', 'image']} draggedTypes={['fileUrl', 'image']}
          onPaste={event => transferPromptImages(event.nativeEvent.dataTransfer.files, setImages)}
          onDrop={event => transferPromptImages(event.nativeEvent.dataTransfer?.files ?? [], setImages)}
          onChangeText={templates.change}
          onSelectionChange={event => templates.select(event.nativeEvent.selection)}
          placeholder="What do you want to work on?" placeholderTextColor={color.hint} style={s.prompt}
          {...{keyDownEvents: [{key: 'Enter'}, ...(templates.open ? [{key: 'ArrowDown'}, {key: 'ArrowUp'}, {key: 'Tab'}, {key: 'Escape'}] : []),
            ...(templates.slots && !templates.open ? [{key: 'Tab'}, {key: 'Tab', shiftKey: true}, {key: 'Escape'}] : [])],
          onKeyDown: (event: {nativeEvent: {key: string; shiftKey?: boolean}; stopPropagation: () => void}) => {
            if (templates.handleKey(event.nativeEvent)) {event.stopPropagation(); return;}
            if (event.nativeEvent.key === 'Enter' && !event.nativeEvent.shiftKey) {event.stopPropagation(); create();}
          }}} />
        {templates.open ? <View style={s.slashAnchor}>
          <ComposerSlashMenu commands={templates.matches} activeIndex={templates.index} onSelect={templates.pick} />
        </View>
          : templates.slots ? <View style={s.slashAnchor}>
            <ComposerSlotHint activeIndex={templates.slots.activeIndex} count={templates.slots.slots.length} onNext={() => templates.step(1)} />
          </View>
          : draft.text.trim() && isolated ? <View {...tid('workspace-naming-hint')}><Text style={s.hint}>ThinkRail will name the workspace and branch from your request.</Text></View>
          : <Text style={s.hint}>Type / for skills and prompt templates — previewed from the current checkout; the created workspace's session is authoritative.</Text>}
        {templates.error ? <Text style={s.error}>{templates.error}</Text> : null}
      </View>
      <View style={s.footer}>
        <View style={s.selectors}>
          <Pressable ref={setModelButton} {...tid('model-selector', {open: picker === 'model'})} accessibilityRole="button"
            onPress={() => setPicker(picker === 'model' ? null : 'model')} style={s.pill}>
            <Text numberOfLines={1} style={s.pillText}>{model?.name ?? 'Default model'}</Text>
            <Icon name="arrowDown" color={color.muted} size={14} />
          </Pressable>
          <Pressable ref={setThinkingButton} {...tid('thinking-selector', {open: picker === 'thinking', disabled: !levels.length})} accessibilityRole="button"
            disabled={!levels.length} onPress={() => setPicker(picker === 'thinking' ? null : 'thinking')} style={[s.pill, !levels.length && s.disabled]}>
            <Text style={s.pillText}>{thinkingLevel}</Text>
            <Icon name="arrowDown" color={color.muted} size={14} />
          </Pressable>
        </View>
        <Pressable {...tid('create-workspace', {disabled: !submitEnabled})} accessibilityRole="button" disabled={!submitEnabled} onPress={create}
          style={[s.create, !submitEnabled && s.createDisabled]}>
          <Text style={s.createText}>{creating ? isolated ? 'Creating…' : 'Starting…' : isolated ? 'Create' : 'Start'}</Text>
          {!creating ? <Text style={s.createKey}>↵</Text> : null}
        </Pressable>
      </View>
    </View>
    {picker ? <ChatPickerMenu key={picker} kind={picker} anchor={picker === 'model' ? modelButton : thinkingButton}
      models={models} currentModel={model} levels={levels} currentLevel={thinkingLevel} onDismiss={() => setPicker(null)}
      onSelectModel={next => {setPicker(null); setModel(next);}} onSelectThinking={level => {setPicker(null); setThinkingLevel(level);}} /> : null}
  </MacView>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  layer: {...StyleSheet.absoluteFillObject, zIndex: 30, alignItems: 'center', justifyContent: 'center'},
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: '#000000a8'},
  dialog: {width: 600, maxWidth: '92%', padding: 12, gap: 12, borderWidth: 1, borderRadius: 8, borderColor: palette.borderStrong, backgroundColor: palette.elevated},
  title: {fontFamily: 'Geist SemiBold', fontSize: 17, color: palette.text},
  description: {fontFamily: 'Geist Native Text', fontSize: 13, lineHeight: 19, color: palette.muted},
  target: {alignSelf: 'flex-start', flexDirection: 'row', gap: 2, padding: 2, borderWidth: 1, borderRadius: 6, borderColor: palette.border, backgroundColor: palette.input},
  targetOption: {height: 28, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 4},
  targetActive: {backgroundColor: palette.primarySubtle},
  targetLabel: {fontFamily: 'Geist Native Text', fontSize: 13, color: palette.muted},
  targetLabelActive: {color: palette.accent},
  row: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, zIndex: 3},
  pill: {height: 32, maxWidth: 220, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 4,
    borderColor: palette.border, backgroundColor: palette.input},
  pillText: {fontFamily: 'Geist Native Text', fontSize: 13, color: palette.text, flexShrink: 1},
  disabled: {opacity: 0.5},
  trust: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderLeftWidth: 3, borderRadius: 4,
    borderColor: palette.border, borderLeftColor: palette.warning, backgroundColor: `${palette.warning}1a`},
  trustText: {flex: 1, fontFamily: 'Geist Native Text', fontSize: 13, color: palette.text},
  trustButton: {height: 28, paddingHorizontal: 8, justifyContent: 'center', borderRadius: 4, backgroundColor: palette.accentSolid},
  trustButtonText: {fontFamily: 'Geist Native Text', fontSize: 13, color: palette.onAccent},
  promptArea: {zIndex: 2},
  note: {marginBottom: 4, flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 4,
    borderColor: palette.primaryMuted, backgroundColor: palette.primarySubtle},
  noteText: {flex: 1, fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 17, color: palette.muted},
  prompt: {minHeight: 160, padding: 8, borderWidth: 1, borderRadius: 4, borderColor: palette.border, backgroundColor: palette.input,
    color: palette.text, fontFamily: 'Geist Native Text', fontSize: 14, textAlignVertical: 'top'},
  slashAnchor: {height: 0, zIndex: 3, top: 4},
  hint: {marginTop: 4, paddingHorizontal: 4, fontFamily: 'Geist Native Text', fontSize: 12, color: palette.muted},
  error: {marginTop: 4, paddingHorizontal: 4, fontFamily: 'Geist Native Text', fontSize: 12, color: palette.red},
  footer: {flexDirection: 'row', alignItems: 'center', gap: 8},
  selectors: {flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  create: {height: 32, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 4, backgroundColor: palette.accentSolid},
  createDisabled: {backgroundColor: palette.primaryDisabledBg},
  createText: {fontFamily: 'Geist Native Text', fontSize: 14, color: palette.onAccent},
  createKey: {minWidth: 16, paddingHorizontal: 4, borderRadius: 4, backgroundColor: '#ffffff26', fontFamily: 'JetBrains Mono', fontSize: 11, color: palette.onAccent, textAlign: 'center'},
});

const useStyles = () => useThemeStyles(makeStyles);
