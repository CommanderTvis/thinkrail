import {useEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, type View as NativeView} from 'react-native';
import {View} from 'react-native-macos';
import {hostClient, useHostClient, type TemplateInfo, type TemplateScope} from './HostClient';
import {Icon, type IconName} from './Icon';
import {ProviderSkeleton} from './ProviderRows';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {assembleTemplate, loadTemplateGroups, starterTemplates} from './templateModel';

export type TemplateEdit = {scope: TemplateScope; template?: TemplateInfo; button: NativeView};

export function TemplateButton({label, icon, onPress, disabled = false, ghost = false, iconOnly = false, small = true, destructive = false, autoFocus = false}: {
  label: string; icon?: IconName; onPress: (button: NativeView) => void; disabled?: boolean; ghost?: boolean; iconOnly?: boolean; small?: boolean; destructive?: boolean; autoFocus?: boolean;
}) {
  const s = useStyles();
  const button = useRef<NativeView>(null);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {if (autoFocus) button.current?.focus();}, [autoFocus]);
  const tint = disabled ? color.disabledText : destructive && hovered ? color.red : ghost && !hovered ? color.muted : color.text;
  return <View {...{tooltip: iconOnly ? label : undefined}} collapsable={false}>
    <Pressable {...{enableFocusRing: true}} ref={button} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled}
      onPress={() => {if (button.current) onPress(button.current);}} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={[s.button, !ghost && s.outlined, !small && s.largeButton, iconOnly && s.iconButton, ghost && !iconOnly && s.newButton,
        hovered && s.hovered, disabled && s.disabled]}>
      {icon ? <Icon name={icon} color={tint} size={14} /> : null}
      {!iconOnly ? <Text style={[s.buttonText, ghost && s.metadataButton, {color: tint}]}>{label}</Text> : null}
    </Pressable>
  </View>;
}

export function TemplatesSettings({version, onChanged, onEdit, onDelete, onOpenFile}: {
  version: number; onChanged: () => void; onEdit: (edit: TemplateEdit) => void;
  onDelete: (template: TemplateInfo, button: NativeView) => void; onOpenFile: (path: string) => void;
}) {
  const s = useStyles();
  const {workspaceId} = useHostClient();
  const [groups, setGroups] = useState<{global: TemplateInfo[]; project: TemplateInfo[]}>();
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  useEffect(() => {
    let current = true;
    setGroups(undefined); setFailed(false);
    loadTemplateGroups(id => hostClient.listTemplates(id ? {workspaceId: id} : {}), workspaceId || undefined)
      .then(next => {if (current) setGroups(next);})
      .catch(() => {if (current) setFailed(true);});
    return () => {current = false;};
  }, [workspaceId, version]);
  const addStarters = async () => {
    if (addingRef.current) return;
    addingRef.current = true; setAdding(true); setError('');
    try {
      for (const template of starterTemplates) await hostClient.saveTemplate(template.name, 'global', assembleTemplate(template.description, template.argumentHint, template.body));
    } catch (reason) {setError(`Couldn't add starter templates: ${String(reason)}`);}
    finally {addingRef.current = false; setAdding(false); onChanged();}
  };
  return <View style={s.section}>
    <View style={s.heading}><Text style={s.title}>Prompt templates</Text>
      <Text style={s.metadata}>Reusable prompts, expanded from the composer's <Text style={s.code}>/</Text> menu. Global templates are available in every workspace; project templates live in this worktree's <Text style={s.code}>.pi/prompts/</Text>.</Text>
    </View>
    {error ? <Text accessibilityRole="alert" style={[s.metadata, s.error]}>{error}</Text> : null}
    {failed ? <Text style={s.ui}>Couldn't read templates from the host — reopen Settings to retry.</Text>
      : !groups ? <ProviderSkeleton label="Loading templates" />
      : (['global', ...(workspaceId ? ['project'] as const : [])] as const).map(scope => <View key={scope} style={s.group}>
        <View style={s.groupHead}><Text style={s.eyebrow}>{scope === 'global' ? 'GLOBAL' : 'THIS PROJECT'}</Text>
          <TemplateButton ghost icon="add" label="New" onPress={button => onEdit({scope, button})} /></View>
        {!groups[scope].length ? scope === 'global' ? <View style={s.group}>
          <Text style={s.metadata}>No templates yet. Add a few common ones to get started.</Text>
          <View style={s.starterButton}><TemplateButton icon="sparkle" label="Add starter templates" disabled={adding} onPress={addStarters} /></View>
        </View> : <Text style={s.metadata}>No templates yet.</Text>
          : <View style={s.rows}>{groups[scope].map(template => <View key={template.name} style={s.row}>
            <View style={s.rowCopy}><Text numberOfLines={1} style={s.name}>{template.name}</Text>
              {template.description ? <Text numberOfLines={1} style={s.metadata}>{template.description}</Text> : null}</View>
            <View style={s.rowActions}>
              {scope === 'project' ? <TemplateButton ghost iconOnly icon="fileText" label="Open as file" onPress={() => onOpenFile(`.pi/prompts/${template.name}.md`)} /> : null}
              <TemplateButton ghost iconOnly icon="pencil" label="Edit" onPress={button => onEdit({scope, template, button})} />
              <TemplateButton ghost iconOnly destructive icon="trash" label="Delete" onPress={button => onDelete(template, button)} />
            </View>
          </View>)}</View>}
      </View>)}
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  section: {gap: 16}, heading: {gap: 4}, group: {gap: 8}, rows: {gap: 4},
  title: {fontFamily: 'Geist Medium', fontSize: 14, lineHeight: 22.4, color: palette.text},
  metadata: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.muted},
  code: {fontFamily: 'JetBrains Mono', fontSize: 13, lineHeight: 20.8},
  ui: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.muted},
  groupHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  eyebrow: {fontFamily: 'Geist Medium', fontSize: 12, lineHeight: 19.2, letterSpacing: 0.24, color: palette.muted},
  row: {flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: palette.border, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: palette.input},
  rowCopy: {flex: 1, minWidth: 0}, name: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.text},
  rowActions: {flexDirection: 'row', alignItems: 'center', gap: 4}, starterButton: {alignSelf: 'flex-start'},
  button: {height: 28, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 4},
  outlined: {borderWidth: 1, borderColor: palette.borderStrong, backgroundColor: palette.input}, largeButton: {height: 32, paddingHorizontal: 12},
  iconButton: {width: 24, height: 24, paddingHorizontal: 0}, newButton: {height: 24, gap: 4},
  buttonText: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20}, metadataButton: {fontSize: 12, lineHeight: 16},
  hovered: {backgroundColor: palette.hover}, disabled: {backgroundColor: palette.hover, borderColor: palette.border}, error: {color: palette.red},
});
const useStyles = () => useThemeStyles(makeStyles);
