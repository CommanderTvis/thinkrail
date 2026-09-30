import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, type TextInputProps} from 'react-native';
import {View} from 'react-native-macos';
import {hostClient} from './HostClient';
import {stripFrontmatter} from './frontmatter';
import {Icon} from './Icon';
import {PrimaryButton} from './PrimaryButton';
import {TemplateButton, type TemplateEdit} from './TemplatesSettings';
import {assembleTemplate, validTemplateName} from './templateModel';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';

export function TemplateEditorDialog({edit, workspaceId, onClose, onSaved}: {
  edit: TemplateEdit; workspaceId?: string; onClose: () => void; onSaved: () => void;
}) {
  const s = useStyles();
  const viewport = useWindowDimensions();
  const {template} = edit;
  const [name, setName] = useState(template?.name ?? '');
  const [scope, setScope] = useState(edit.scope);
  const [description, setDescription] = useState(template?.description ?? '');
  const [argumentHint, setArgumentHint] = useState(template?.argumentHint ?? '');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(Boolean(template));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [hoveredClose, setHoveredClose] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  useEffect(() => {
    if (!template) return;
    let current = true;
    hostClient.getTemplate(template, workspaceId ? {workspaceId} : {}).then(value => {
      if (!current) return;
      setDescription(value.description ?? ''); setArgumentHint(value.argumentHint ?? '');
      setBody(stripFrontmatter(value.content)); setLoading(false);
    }).catch(reason => {if (current) setError(String(reason));});
    return () => {current = false;};
  }, [template, workspaceId]);
  const save = async () => {
    if (savingRef.current || loading) return;
    const finalName = template?.name ?? name.trim();
    if (!validTemplateName(finalName)) {setError('Name can\'t be empty, start with ".", or contain "/", "\\", or a null byte.'); return;}
    if (scope === 'project' && !workspaceId) {setError('Open a workspace first — a project-scoped template needs one.'); return;}
    savingRef.current = true; setSaving(true); setError('');
    try {
      await hostClient.saveTemplate(finalName, scope, assembleTemplate(description, argumentHint, body), workspaceId);
      if (!mounted.current) return;
      onSaved(); onClose();
    } catch (reason) {if (mounted.current) setError(String(reason));}
    finally {savingRef.current = false; if (mounted.current) setSaving(false);}
  };
  const field = (label: string, child: ReactNode) => <View style={s.field}><Text style={s.label}>{label}</Text>{child}</View>;
  const input = (label: string, value: string, change: (next: string) => void, placeholder: string, disabled = false, autoFocus = false) =>
    <TemplateInput accessibilityLabel={label} value={value} onChangeText={change} editable={!disabled} autoFocus={autoFocus} placeholder={placeholder} />;
  return <View style={s.overlay} keyDownEvents={[{key: 'Escape'}]} onKeyDown={event => {
    if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); onClose();}
  }}>
    <Pressable style={s.backdrop} onPress={onClose} />
    <View style={s.dialog} accessibilityLabel={template ? `Edit ${template.name}` : 'New template'} accessibilityViewIsModal>
      <Text style={s.title}>{template ? `Edit ${template.name}` : 'New template'}</Text>
      <Pressable {...{enableFocusRing: true}} accessibilityRole="button" accessibilityLabel="Close template editor" onPress={onClose}
        onHoverIn={() => setHoveredClose(true)} onHoverOut={() => setHoveredClose(false)} style={[s.close, hoveredClose && s.hovered]}>
        <Icon name="close" size={16} color={hoveredClose ? color.text : color.muted} /></Pressable>
      <ScrollView style={[s.scroll, {maxHeight: viewport.height * 0.6}]} contentContainerStyle={s.fields} keyboardShouldPersistTaps="handled">
        {field('Name', input('Template name', name, setName, 'standup', Boolean(template), !template))}
        <View style={s.field}><Text style={s.label}>Scope</Text><View style={s.scopes}>
          {(['global', 'project'] as const).map(value => <ScopeOption key={value} label={value === 'global' ? 'Global' : 'This project'} active={scope === value}
            disabled={Boolean(template) || (value === 'project' && !workspaceId)} onPress={() => setScope(value)} />)}
        </View>{!workspaceId && !template ? <Text style={s.metadata}>Open a workspace to save a project-scoped template.</Text> : null}</View>
        {field('Description', input('Template description', description, setDescription, 'What this template is for'))}
        {field('Argument hint', input('Template argument hint', argumentHint, setArgumentHint, '[file] [scope]'))}
        {field('Body', <><TemplateInput accessibilityLabel="Template body" value={body} onChangeText={setBody} editable={!loading} multiline placeholder="Prompt body…" />
          <Text style={s.metadata}>$1, $ARGUMENTS, ${'{1:-default}'} — pi prompt-template syntax</Text></>)}
        {error ? <Text accessibilityRole="alert" style={[s.metadata, s.error]}>{error}</Text> : null}
      </ScrollView>
      <View style={s.footer}><TemplateButton small={false} label="Cancel" onPress={onClose} />
        <PrimaryButton label="Save" onPress={save} disabled={saving || loading || (!template && !name.trim())} /></View>
    </View>
  </View>;
}

function TemplateInput(props: TextInputProps) {
  const s = useStyles();
  const [focused, setFocused] = useState(false);
  return <TextInput {...props} autoCorrect={false} spellCheck={false} placeholderTextColor={color.muted}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={[s.input, props.multiline && s.body, focused && s.focusedInput, props.editable === false && s.disabledInput, props.editable === false && s.disabledText]} />;
}

function ScopeOption({label, active, disabled, onPress}: {label: string; active: boolean; disabled: boolean; onPress: () => void}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <Pressable {...{enableFocusRing: true}} accessibilityRole="button" accessibilityState={{selected: active, disabled}} disabled={disabled} onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[s.scope, active && s.activeScope, hovered && !disabled && s.hovered, disabled && s.disabledInput]}>
    <Text style={[s.scopeText, (active || hovered) && s.scopeActiveText, disabled && s.disabledText]}>{label}</Text>
  </Pressable>;
}
const makeStyles = (palette: Palette) => StyleSheet.create({
  overlay: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 60, alignItems: 'center', justifyContent: 'center'},
  backdrop: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)'},
  dialog: {width: '100%', maxWidth: 576, maxHeight: '85%', padding: 16, gap: 12, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.borderStrong,
    borderRadius: 8, shadowColor: '#000000', shadowOffset: {width: 0, height: 8}, shadowRadius: 14, shadowOpacity: palette.bg === '#ffffff' ? 0.14 : 0.4},
  title: {fontFamily: 'Geist SemiBold', fontSize: 14, lineHeight: 17.5, color: palette.text},
  close: {position: 'absolute', top: 12, right: 12, width: 24, height: 24, borderRadius: 4, alignItems: 'center', justifyContent: 'center'},
  scroll: {flexShrink: 1}, fields: {gap: 12}, field: {gap: 4},
  label: {fontFamily: 'Geist Medium', fontSize: 14, lineHeight: 20, color: palette.text},
  input: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.text, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: palette.borderStrong, backgroundColor: palette.input, borderRadius: 4},
  body: {height: 178, textAlignVertical: 'top'}, metadata: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.muted},
  scopes: {flexDirection: 'row', gap: 8}, scope: {flex: 1, borderWidth: 1, borderColor: palette.border, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8},
  activeScope: {borderColor: palette.primaryMuted, backgroundColor: palette.primarySubtle},
  scopeText: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.muted}, scopeActiveText: {color: palette.text},
  disabledInput: {backgroundColor: palette.hover}, disabledText: {color: palette.disabledText}, hovered: {backgroundColor: palette.hover},
  focusedInput: {borderColor: palette.accent},
  footer: {flexDirection: 'row', justifyContent: 'flex-end', gap: 8}, error: {color: palette.red},
});
const useStyles = () => useThemeStyles(makeStyles);
