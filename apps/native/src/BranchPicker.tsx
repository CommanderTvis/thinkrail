import {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {View as MacView} from 'react-native-macos';
import type {BranchList} from './HostClient';
import {Icon} from './Icon';
import {SpinningIcon} from './SpinningIcon';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {tid} from './testId';

type Group = {heading: string; nested?: boolean; items: {ref: string; label: string}[]};

function branchGroups(branches: BranchList | null, query: string): Group[] {
  const match = (ref: string) => ref.toLowerCase().includes(query.trim().toLowerCase());
  const groups: Group[] = [];
  if (Array.isArray(branches?.remoteGroups)) {
    const remote = branches.remoteGroups
      .map(group => ({heading: group.remote ?? 'Other', nested: true, items: group.branches.filter(item => match(item.ref)).map(item => ({ref: item.ref, label: item.branch}))}))
      .filter(group => group.items.length > 0);
    if (remote.length) groups.push({heading: 'Remote', items: []}, ...remote);
  } else {
    const refs = (branches?.remote ?? []).filter(match);
    if (refs.length) groups.push({heading: 'Remote', items: refs.map(ref => ({ref, label: ref}))});
  }
  const local = (branches?.local ?? []).filter(match);
  if (local.length) groups.push({heading: 'Local', items: local.map(ref => ({ref, label: ref}))});
  return groups;
}

export function BranchPicker({branches, selected, label, testId, refreshing = false, onSelect, onRefresh}: {
  branches: BranchList | null; selected: string; label: string; testId: string; refreshing?: boolean;
  onSelect: (ref: string) => void; onRefresh: () => void;
}) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const groups = branchGroups(branches, query);
  const toggle = () => {
    if (!open) {setQuery(''); onRefresh();}
    setOpen(!open);
  };
  return <View style={s.anchor}>
    <Pressable {...tid(testId, {open})} accessibilityRole="button" style={s.pill} onPress={toggle}>
      <Icon name="gitBranch" color={color.muted} size={14} />
      <Text style={s.muted}>{label}</Text>
      <Text numberOfLines={1} style={s.muted}>{selected || 'branch'}</Text>
      <Icon name="arrowDown" color={color.muted} size={14} />
    </Pressable>
    {open ? <MacView {...tid('branch-popover')} style={s.popover} keyDownEvents={[{key: 'Escape'}]}
      onKeyDown={event => {if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); setOpen(false);}}}>
      <View style={s.toolbar}>
        <Pressable {...tid('branch-refresh')} accessibilityRole="button" accessibilityLabel="Refresh branches" onPress={onRefresh} style={s.refresh}>
          {refreshing ? <SpinningIcon name="refresh" color={color.muted} size={14} /> : <Icon name="refresh" color={color.muted} size={14} />}
        </Pressable>
      </View>
      <TextInput {...tid('branch-search')} autoFocus value={query} onChangeText={setQuery} placeholder="Search branches…"
        placeholderTextColor={color.hint} style={s.search} />
      <ScrollView style={s.list}>
        {groups.map(group => <View key={`${group.heading}:${group.nested ? 'remote' : 'top'}`} {...tid('branch-group', {name: group.heading})}>
          <Text style={[s.heading, group.nested && s.nestedHeading]}>{group.heading}</Text>
          {group.items.map(item => <Pressable key={item.ref} {...tid('branch-option', {branch: item.ref, active: item.ref === selected || undefined})}
            accessibilityRole="menuitem" style={[s.option, group.nested && s.nestedOption]} onPress={() => {onSelect(item.ref); setOpen(false);}}>
            <View style={s.check}>{item.ref === selected ? <Icon name="check" color={color.accent} size={14} /> : null}</View>
            <Icon name="gitBranch" color={color.muted} size={14} />
            <Text numberOfLines={1} style={s.optionText}>{item.label}</Text>
            {item.ref === branches?.defaultBranch ? <Text style={s.muted}>default</Text> : null}
          </Pressable>)}
        </View>)}
        {!groups.length ? <Text style={s.empty}>No branches found.</Text> : null}
      </ScrollView>
    </MacView> : null}
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  anchor: {zIndex: 5},
  pill: {height: 32, maxWidth: 220, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 4,
    borderColor: palette.border, backgroundColor: palette.input},
  muted: {fontFamily: 'Geist Native Text', fontSize: 12, color: palette.muted, flexShrink: 1},
  popover: {position: 'absolute', top: 36, left: 0, width: 320, padding: 4, borderWidth: 1, borderRadius: 6, borderColor: palette.borderStrong, backgroundColor: palette.elevated},
  toolbar: {flexDirection: 'row', justifyContent: 'flex-end', paddingBottom: 4, borderBottomWidth: 1, borderColor: palette.border},
  refresh: {width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 4},
  search: {height: 30, marginVertical: 4, paddingHorizontal: 8, borderBottomWidth: 1, borderColor: palette.border, color: palette.text, fontFamily: 'Geist Native Text', fontSize: 13},
  list: {maxHeight: 280},
  heading: {paddingHorizontal: 8, paddingTop: 6, paddingBottom: 2, fontFamily: 'Geist Native Text', fontSize: 11, color: palette.muted},
  nestedHeading: {paddingLeft: 16},
  option: {minHeight: 28, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 4},
  nestedOption: {paddingLeft: 16},
  check: {width: 14, alignItems: 'center'},
  optionText: {flex: 1, fontFamily: 'Geist Native Text', fontSize: 12, color: palette.text},
  empty: {padding: 8, fontFamily: 'Geist Native Text', fontSize: 12, color: palette.muted},
});

const useStyles = () => useThemeStyles(makeStyles);
