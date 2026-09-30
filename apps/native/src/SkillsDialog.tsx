import {useCallback, useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {View as MacView} from 'react-native-macos';
import {hostClient, useHostClient, type SkillCatalogEntry} from './HostClient';
import {Icon} from './Icon';
import {PrimaryButton} from './PrimaryButton';
import {skillGroups, skillSwitchHint, type SkillGroup} from './skillGroups';
import {tid} from './testId';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {toast} from './toast';

function SkillSwitch({testId, skill, checked, busy, blockedReason, label, onChange}: {
  testId: string; skill?: string; checked: boolean; busy: boolean; blockedReason?: string; label: string; onChange: (checked: boolean) => void;
}) {
  const s = useStyles();
  const disabled = busy || blockedReason !== undefined;
  const hint = skillSwitchHint(checked, busy, blockedReason);
  return <Pressable {...tid(testId, {skill, checked, disabled, hint})} disabled={disabled} onPress={() => onChange(!checked)}
    accessibilityRole="switch" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{checked, disabled}}
    {...{tooltip: hint}} style={[s.track, checked && s.trackOn, disabled && s.disabled]}>
    <View style={[s.thumb, checked && s.thumbOn]} />
  </Pressable>;
}

export function SkillsDialog({onClose}: {onClose: () => void}) {
  const s = useStyles();
  const {projects, projectId, workspaceId, sessionId, streaming} = useHostClient();
  const project = projects.find(item => item.id === projectId);
  const [entries, setEntries] = useState<SkillCatalogEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {setEntries(await hostClient.skillCatalog(projectId, workspaceId));}
    catch {setEntries([]);}
  }, [projectId, workspaceId]);
  useEffect(() => {setEntries(null); refresh();}, [refresh]);
  const mutate = async (request: () => Promise<unknown>, failure: string) => {
    if (busy) return;
    setBusy(true);
    try {await request(); await refresh();}
    catch (reason) {toast.error(String(reason), failure);}
    setBusy(false);
  };
  const disabledGroups = new Set(project?.disabledGroups ?? []);
  const pluginsDisabled = disabledGroups.has('@plugins');
  const untrusted = entries?.filter(entry => entry.decision === 'untrusted').length ?? 0;
  const groups = skillGroups(entries ?? []);
  const setGroup = (group: string, enabled: boolean) => mutate(() => hostClient.setSkillGroupEnabled(projectId, group, enabled), "Couldn't update group");
  const renderGroup = (group: SkillGroup) => {
    const locked = group.isPlugin && pluginsDisabled;
    const on = !locked && !disabledGroups.has(group.key);
    const blocked = on ? undefined : locked ? 'Off — turn on All plugins first' : `Off — turn on ${group.label} first`;
    return <View key={group.key} {...tid('skill-group', {group: group.key, on})}>
      <View style={s.groupHeader}>
        {group.isPlugin ? <Icon name="sparkle" size={14} color={color.muted} /> : null}
        <Text style={s.groupLabel}>{group.label.toUpperCase()}</Text>
        <Text numberOfLines={1} style={s.groupHint}>{group.hint}</Text>
        <View style={s.count}><Text style={s.metadata}>{group.items.length}</Text></View>
        <SkillSwitch testId="group-toggle" checked={on} busy={busy} blockedReason={locked ? 'Off — turn on All plugins first' : undefined}
          label={`Enable ${group.label} skill group`} onChange={enabled => setGroup(group.key, enabled)} />
      </View>
      <View style={s.rows}>{group.items.map(entry => <View key={entry.name} {...tid('skill-row', {skill: entry.name, decision: entry.decision, group: group.key})} style={s.row}>
        <View style={s.rowCopy}><Text {...tid('skill-name')} numberOfLines={1} style={s.ui}>{entry.name}</Text>
          {entry.description ? <Text numberOfLines={1} style={s.metadata}>{entry.description}</Text> : null}</View>
        {entry.decision === 'pending-ack'
          ? <PrimaryButton {...tid('skill-ack')} small icon="shield" label="Enable" disabled={busy}
            onPress={() => mutate(() => hostClient.acknowledgeSkill(projectId, entry.name), "Couldn't confirm skill")} />
          : <SkillSwitch testId="skill-toggle" skill={entry.name} checked={entry.decision === 'load' && !blocked} busy={busy}
            blockedReason={entry.decision === 'untrusted' ? 'Off — trust this project first' : blocked} label={`Enable skill ${entry.name}`}
            onChange={enabled => mutate(() => hostClient.setSkillEnabled(projectId, workspaceId, entry.name, enabled), "Couldn't update skill")} />}
      </View>)}</View>
    </View>;
  };
  const reload = () => mutate(async () => {
    await hostClient.reloadSessionResources(sessionId);
    toast.success('This chat now uses the updated skills.', 'Skills reloaded');
  }, "Couldn't reload skills");
  return <MacView style={s.layer} keyDownEvents={[{key: 'Escape'}]} onKeyDown={event => {
    if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); onClose();}
  }}>
    <Pressable {...tid('dialog-overlay')} style={s.backdrop} onPress={onClose} />
    <View {...tid('skills-dialog')} style={s.dialog}>
      <View style={s.titleRow}><Text style={s.ui}>Skills</Text>
        {sessionId ? <PrimaryButton {...tid('skills-reload')} small icon="refresh" label="Reload" disabled={busy || streaming} onPress={reload} /> : null}
      </View>
      {untrusted > 0 ? <View {...tid('skills-trust-all')} style={s.trust}>
        <Text style={[s.ui, s.fill]}>{untrusted} project skill{untrusted === 1 ? '' : 's'} off until you trust this repo.</Text>
        <PrimaryButton small label="Trust project" disabled={busy} onPress={() => mutate(() => hostClient.trustProject(projectId), "Couldn't trust project")} />
      </View> : null}
      <ScrollView style={s.list}>
        {entries === null ? <Text style={s.empty}>Loading skills…</Text>
          : !entries.length ? <Text style={s.empty}>No skills discovered.</Text>
          : <>
            {groups.filter(group => group.leading).map(renderGroup)}
            {groups.some(group => group.isPlugin) ? <View {...tid('skills-all-plugins')} style={s.groupHeader}>
              <Text style={[s.groupLabel, s.fill]}>ALL PLUGINS</Text>
              <SkillSwitch testId="all-plugins-toggle" checked={!pluginsDisabled} busy={busy} label="Enable all plugins" onChange={enabled => setGroup('@plugins', enabled)} />
            </View> : null}
            {groups.filter(group => !group.leading).map(renderGroup)}
          </>}
      </ScrollView>
    </View>
  </MacView>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  layer: {...StyleSheet.absoluteFillObject, zIndex: 40, alignItems: 'center', justifyContent: 'center'},
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: '#00000088'},
  dialog: {width: 560, maxWidth: '92%', maxHeight: '80%', padding: 12, gap: 12, borderRadius: 8, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.borderStrong},
  titleRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8},
  ui: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 14, lineHeight: 20},
  metadata: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12, lineHeight: 16},
  fill: {flex: 1, minWidth: 0},
  trust: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, borderWidth: 1, borderColor: palette.border, borderLeftWidth: 3, borderLeftColor: palette.warning},
  list: {flexShrink: 1},
  empty: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 14, lineHeight: 20, paddingHorizontal: 8, paddingVertical: 12},
  groupHeader: {minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 6, borderTopWidth: 1, borderBottomWidth: 1, borderColor: palette.border, backgroundColor: palette.surface},
  groupLabel: {fontFamily: 'Geist Medium', color: palette.text, fontSize: 11, lineHeight: 16, letterSpacing: 0.5},
  groupHint: {flex: 1, minWidth: 0, fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12, lineHeight: 16},
  count: {paddingHorizontal: 8, borderRadius: 8, backgroundColor: palette.hover},
  rows: {marginLeft: 8, borderLeftWidth: 1, borderColor: palette.border},
  row: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingRight: 8, paddingLeft: 12, borderBottomWidth: 1, borderColor: palette.border},
  rowCopy: {flex: 1, minWidth: 0},
  track: {width: 36, height: 20, borderRadius: 10, backgroundColor: palette.border, padding: 2},
  trackOn: {backgroundColor: palette.accent}, thumb: {width: 16, height: 16, borderRadius: 8, backgroundColor: palette.surface}, thumbOn: {alignSelf: 'flex-end'},
  disabled: {opacity: 0.45},
});

const useStyles = () => useThemeStyles(makeStyles);
