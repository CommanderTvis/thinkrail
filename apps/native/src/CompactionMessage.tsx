import {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useChatFold} from './chatFolds';
import {formatCompactionTokens, type CompactionState} from './compactionModel';
import {Icon} from './Icon';
import {MarkdownText} from './MarkdownText';
import {SpinningIcon} from './SpinningIcon';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';

export function CompactionMessage({id, state}: {id: string; state: CompactionState}) {
  const s = useThemeStyles(makeStyles);
  const [open, toggle] = useChatFold(id);
  const [hovered, setHovered] = useState(false);
  const label = state.status === 'running' ? 'Compacting context…' : state.status === 'cancelled' ? 'Compaction cancelled'
    : state.resuming ? 'Context compacted — resuming…' : 'Context compacted';
  const before = state.tokensBefore === undefined ? null : formatCompactionTokens(state.tokensBefore);
  const after = state.tokensAfter === undefined ? null : formatCompactionTokens(state.tokensAfter);
  const tokens = before !== null && (after !== null || state.summary !== undefined) ? `${before}${after === null ? '' : ` → ${after}`} tokens` : null;
  if (state.status === 'failed') return <View accessibilityRole="alert" style={s.failure}>
    <View style={s.failureIcon}><Icon name="alertWarning" size={12} color={color.red} /></View>
    <Text selectable style={s.failureText}>{state.detail || 'Compaction failed.'}</Text>
  </View>;
  if (state.summary !== undefined) return <View style={s.summary}>
    <Pressable {...{enableFocusRing: true}} accessibilityRole="button" accessibilityState={{expanded: open}} onPress={toggle}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={s.disclosure}>
      <View style={s.rule} /><Icon name={open ? 'arrowDown' : 'arrowRight'} size={16} color={hovered ? color.text : color.muted} />
      <Text style={[s.metadata, hovered && s.hovered]}>{label}{tokens ? ` (${tokens})` : ''}</Text><View style={s.rule} />
    </Pressable>
    {open ? <MarkdownText text={state.summary} /> : null}
  </View>;
  return <View style={s.notice}>
    {state.status === 'running' ? <SpinningIcon name="compactionSpin" size={12} color={color.muted} /> : <Icon name="compaction" size={12} color={color.muted} />}
    <Text style={s.metadata}>{label}</Text>{tokens ? <Text style={s.metadata}>({tokens})</Text> : null}
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  summary: {gap: 8}, disclosure: {flexDirection: 'row', alignItems: 'center', gap: 8}, rule: {height: 1, flex: 1, backgroundColor: palette.border},
  notice: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8},
  metadata: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.muted}, hovered: {color: palette.text},
  failure: {flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1,
    borderColor: `${palette.red}66`, backgroundColor: `${palette.red}1f`}, failureIcon: {marginTop: 2},
  failureText: {flexShrink: 1, fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.red},
});
