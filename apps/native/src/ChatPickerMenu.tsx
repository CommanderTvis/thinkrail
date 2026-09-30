import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, useWindowDimensions, type View as NativeView} from 'react-native';
import {Pressable, TextInput, View} from 'react-native-macos';
import {hostClient, type Model} from './HostClient';
import {Icon} from './Icon';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {chatPickerPlacement, type PickerRect} from './chatPickerGeometry';
import {pickerNavigation, pickerNavigationKeys, pickerScrollOffset} from './chatPickerNavigation';
import {SpinningIcon} from './SpinningIcon';
import {modelPickerGroups} from './modelPickerGroups';
import {tid} from './testId';

type PickerKind = 'model' | 'thinking';

function formatContext(tokens: number) {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`.replace('.0', '');
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function PickerRow({label, detail, suffix, selected, capitalize = false, active, element, onActive, onFocus, onPress}: {
  label: string; detail?: string; suffix?: string; selected: boolean; capitalize?: boolean; active: boolean;
  element: (view: NativeView | null) => void; onActive: () => void; onFocus: () => void; onPress: () => void;
}) {
  const s = useStyles();
  return <Pressable ref={element} {...{enableFocusRing: true, keyDownEvents: [...pickerNavigationKeys, ...(capitalize ? [{key: ' '}] : [])]}}
    accessibilityRole="menuitem" accessibilityState={{selected: capitalize ? selected : active}} onPress={onPress} onFocus={onFocus}
    onKeyDown={event => {if (event.nativeEvent.key === 'Enter' || event.nativeEvent.key === ' ') event.stopPropagation();}}
    onHoverIn={onActive} style={[s.row, capitalize && s.thinkingRow, active && s.hovered]}>
    <View style={s.check}>{selected ? <Icon name="check" color={color.accent} size={14} /> : null}</View>
    <View style={s.rowCopy}><Text numberOfLines={1} style={[s.label, capitalize && s.capitalize]}>{label}</Text>
      {detail ? <Text numberOfLines={1} style={s.detail}>{detail}</Text> : null}</View>
    {suffix ? <Text numberOfLines={1} style={s.suffix}>{suffix}</Text> : null}
  </Pressable>;
}

export function ChatPickerMenu({kind, models, currentModel, levels, currentLevel, onDismiss, onSelectModel, onSelectThinking, defaultOption, anchor}: {
  kind: PickerKind; models: Model[]; currentModel?: Model | null; levels: string[]; currentLevel: string;
  onDismiss: () => void; onSelectModel: (model: Model) => void; onSelectThinking: (level: string) => void;
  defaultOption?: {label: string; onSelect: () => void}; anchor: NativeView | null;
}) {
  const s = useStyles();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [refreshHovered, setRefreshHovered] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(kind === 'thinking' ? currentLevel : null);
  const [navigationEnabled, setNavigationEnabled] = useState(true);
  const [listViewport, setListViewport] = useState(0);
  const list = useRef<ScrollView>(null);
  const content = useRef<NativeView>(null);
  const rows = useRef(new Map<string, NativeView>());
  const scrollOffset = useRef(0);
  const scrollGuard = useRef({value: 0});
  const layer = useRef<NativeView>(null);
  const generation = useRef({value: 0});
  const [geometry, setGeometry] = useState<{trigger: PickerRect; bounds: PickerRect} | null>(null);
  const [contentHeight, setContentHeight] = useState(kind === 'model' ? 280 : levels.length * 28);
  const [errorHeight, setErrorHeight] = useState(0);
  const menuHeight = kind === 'model' ? Math.min(contentHeight, 280) + 64 + (error ? errorHeight : 0) : contentHeight + 10;
  const {width, height} = useWindowDimensions();
  const measure = useCallback(() => {
    const request = ++generation.current.value;
    anchor?.measureInWindow((x, y, triggerWidth, triggerHeight) => {
      if (request !== generation.current.value) return;
      layer.current?.measureInWindow((rootX, rootY, rootWidth, rootHeight) => {
        if (request !== generation.current.value) return;
        setGeometry({trigger: {x, y, width: triggerWidth, height: triggerHeight}, bounds: {x: rootX, y: rootY, width: rootWidth, height: rootHeight}});
      });
    });
  }, [anchor]);
  useLayoutEffect(() => {
    const guard = generation.current;
    measure();
    return () => {guard.value++;};
  }, [measure, width, height, menuHeight, currentModel?.name, currentLevel]);
  const menuPlacement = geometry ? chatPickerPlacement(geometry.trigger, geometry.bounds, kind === 'model' ? 320 : 160, menuHeight) : null;
  const dismiss = () => {anchor?.focus(); onDismiss();};
  const select = (action: () => void) => {anchor?.focus(); action();};
  const refresh = async (force: boolean) => {
    setRefreshing(true);
    setError('');
    try {await hostClient.refreshModels(force);}
    catch (reason) {setError(String(reason));}
    finally {setRefreshing(false);}
  };
  useEffect(() => {if (kind === 'model') refresh(false);}, [kind]);
  const groups = modelPickerGroups(models, query, defaultOption?.label);
  const modelKey = (model: Model) => JSON.stringify([model.provider, model.id]);
  const options = kind === 'model' ? groups.flatMap((group, index) => group.kind === 'default'
    ? (defaultOption ? [{key: 'default', group: index, action: defaultOption.onSelect}] : [])
    : group.models.map(model => ({key: modelKey(model), group: index, action: () => onSelectModel(model)})))
    : levels.map(level => ({key: level, group: 0, action: () => onSelectThinking(level)}));
  const activeIndex = Math.max(0, options.findIndex(option => option.key === activeKey));
  const activeId = options[activeIndex]?.key;
  useLayoutEffect(() => {
    const guard = scrollGuard.current;
    const request = ++guard.value;
    const row = activeId ? rows.current.get(activeId) : undefined;
    if (kind === 'thinking' && navigationEnabled && geometry) row?.focus();
    if (content.current && row) row.measureLayout(content.current, (_x, y, _width, rowHeight) => {
      if (request !== guard.value) return;
      const offset = pickerScrollOffset(y + (kind === 'model' ? 4 : 0), rowHeight, scrollOffset.current, listViewport);
      if (offset !== null) list.current?.scrollTo({y: offset, animated: false});
    }, () => {});
    return () => {guard.value++;};
  }, [activeId, kind, navigationEnabled, geometry, contentHeight, listViewport, models, query, levels]);
  const rowProps = (key: string) => ({
    active: key === activeId,
    element: (view: NativeView | null) => {if (view) rows.current.set(key, view); else rows.current.delete(key);},
    onActive: () => setActiveKey(key),
    onFocus: () => {setNavigationEnabled(true); setActiveKey(key);},
  });
  return <View ref={layer} collapsable={false} onLayout={measure} style={s.layer}
    keyDownEvents={[{key: 'Escape'}, ...pickerNavigationKeys, ...(kind === 'thinking' ? [{key: ' '}] : [])]}
    onKeyDown={event => {
      const key = event.nativeEvent.key;
      if (key === 'Escape') {event.stopPropagation(); dismiss(); return;}
      if (!navigationEnabled) return;
      if (key === 'Enter' || (key === ' ' && kind === 'thinking')) {
        event.stopPropagation();
        if (options[activeIndex]) select(options[activeIndex].action);
        return;
      }
      const next = pickerNavigation(event.nativeEvent, activeIndex, options.length, options.map(option => option.group));
      if (next !== null) {event.stopPropagation(); setActiveKey(options[next].key);}
    }}>
    <Pressable style={s.backdrop} onPress={dismiss} />
    <View accessibilityRole="menu" accessibilityLabel={kind === 'model' ? 'Models' : 'Thinking levels'}
      style={[s.menu, kind === 'thinking' && s.thinkingMenu, menuPlacement, !menuPlacement && s.hidden]}>
      {kind === 'model' ? <>
        <View style={s.searchRow}><Icon name="search" color={color.muted} size={14} /><TextInput autoFocus value={query}
          keyDownEvents={[{key: 'Escape'}, ...pickerNavigationKeys]}
          onKeyPress={event => {if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); dismiss();}}}
          onFocus={() => setNavigationEnabled(true)} onChangeText={text => {setQuery(text); setActiveKey(null);}} placeholder="Search models…"
          placeholderTextColor={color.muted} style={s.search} accessibilityLabel="Search models" /></View>
        <ScrollView ref={list} style={s.list} contentContainerStyle={s.listContent} keyboardShouldPersistTaps="always" onContentSizeChange={(_, listHeight) => setContentHeight(listHeight)}
          onLayout={event => setListViewport(event.nativeEvent.layout.height)} onScroll={event => {scrollOffset.current = event.nativeEvent.contentOffset.y;}} scrollEventThrottle={16}>
          <View ref={content} collapsable={false}>
          {groups.map(group => group.kind === 'default'
            ? (defaultOption ? <PickerRow key="default" {...rowProps('default')} label={defaultOption.label} selected={!currentModel} onPress={() => select(defaultOption.onSelect)} /> : null)
            : <View key={group.provider}>
            <Text style={s.provider}>{group.provider}</Text>
            {group.models.map(model => <PickerRow key={modelKey(model)} {...rowProps(modelKey(model))}
              label={model.name} detail={[`${formatContext(model.contextWindow)} context`, model.reasoning ? 'reasoning' : ''].filter(Boolean).join(' · ')}
              suffix={model.id} selected={currentModel?.provider === model.provider && currentModel?.id === model.id}
              onPress={() => select(() => onSelectModel(model))} />)}
          </View>)}
          {!options.length ? <Text style={s.empty}>{refreshing ? 'Loading models…' : 'No models found.'}</Text> : null}
          </View>
        </ScrollView>
        {error ? <Text onLayout={event => setErrorHeight(event.nativeEvent.layout.height)} style={s.error}>{error}</Text> : null}
        <Pressable {...tid('model-refresh', {refreshing})} {...{enableFocusRing: true}} accessibilityRole="button" disabled={refreshing} onPress={() => refresh(true)}
          onFocus={() => setNavigationEnabled(false)}
          onHoverIn={() => setRefreshHovered(true)} onHoverOut={() => setRefreshHovered(false)} style={[s.refresh, refreshHovered && !refreshing && s.hovered]}>
          {refreshing ? <SpinningIcon name="refresh" color={color.muted} size={14} /> : <Icon name="refresh" color={refreshHovered ? color.text : color.muted} size={14} />}
          <Text style={[s.detail, refreshHovered && !refreshing && s.refreshHovered]}>{refreshing ? 'Updating catalog…' : 'Refresh catalog'}</Text>
        </Pressable>
      </> : <ScrollView ref={list} style={s.thinkingList} keyboardShouldPersistTaps="always" onContentSizeChange={(_, listHeight) => setContentHeight(listHeight)}
        onLayout={event => setListViewport(event.nativeEvent.layout.height)} onScroll={event => {scrollOffset.current = event.nativeEvent.contentOffset.y;}} scrollEventThrottle={16}>
        <View ref={content} collapsable={false}>{levels.map(level => <PickerRow key={level} {...rowProps(level)} label={level} selected={level === currentLevel} capitalize
          onPress={() => select(() => onSelectThinking(level))} />)}</View></ScrollView>}
    </View>
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  layer: {...StyleSheet.absoluteFillObject, zIndex: 10}, backdrop: {...StyleSheet.absoluteFillObject},
  menu: {position: 'absolute', width: 320, maxHeight: 360, borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 6, backgroundColor: palette.elevated, overflow: 'hidden', shadowColor: '#000000', shadowOffset: {width: 0, height: 4}, shadowRadius: 8, shadowOpacity: palette.mediumShadowOpacity},
  thinkingMenu: {width: 160, padding: 4}, thinkingList: {flexShrink: 1}, hidden: {opacity: 0},
  searchRow: {flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, borderBottomWidth: 1, borderColor: palette.border},
  search: {height: 36, flex: 1, color: palette.text, fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, padding: 0},
  list: {maxHeight: 280, flexShrink: 1}, listContent: {padding: 4}, provider: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 14, lineHeight: 20, paddingHorizontal: 8, paddingVertical: 4},
  row: {paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 4}, thinkingRow: {gap: 8},
  hovered: {backgroundColor: palette.hover}, check: {width: 14}, rowCopy: {flex: 1, minWidth: 0},
  label: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 14, lineHeight: 20}, capitalize: {textTransform: 'capitalize'},
  detail: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12, lineHeight: 16},
  suffix: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12, lineHeight: 16},
  empty: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 14, lineHeight: 20, paddingVertical: 12, textAlign: 'center'},
  error: {fontFamily: 'Geist Native Text', color: palette.red, fontSize: 11, paddingHorizontal: 9, paddingBottom: 6},
  refresh: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 4, borderTopWidth: 1, borderColor: palette.borderStrong}, refreshHovered: {color: palette.text},
});

const useStyles = () => useThemeStyles(makeStyles);
