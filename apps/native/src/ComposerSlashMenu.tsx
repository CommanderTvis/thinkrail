import {Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import type {SlashCommandItem} from './slashCompletion';
import {Icon} from './Icon';
import {useState} from 'react';
import {tid} from './testId';

export function ComposerSlashMenu({commands, activeIndex, onSelect, onManageTemplates}: {commands: SlashCommandItem[]; activeIndex: number; onSelect: (command: SlashCommandItem) => void; onManageTemplates?: () => void}) {
  const s = useThemeStyles(makeStyles);
  const [footerHovered, setFooterHovered] = useState(false);
  const viewport = useWindowDimensions();
  return <View {...tid('slash-menu')} style={[s.menu, {maxHeight: viewport.height * 0.4}]}>
    <ScrollView keyboardShouldPersistTaps="handled" accessibilityRole="menu" accessibilityLabel="Slash commands" contentContainerStyle={s.content}>
      {commands.map((command, index) => <Pressable key={`${command.source}:${command.sourceInfo.path}:${command.name}`} {...tid('slash-command', {name: command.name, active: index === activeIndex})} accessibilityRole="menuitem"
        accessibilityLabel={`/${command.name}${command.description ? `, ${command.description}` : ''}`} accessibilityState={{selected: index === activeIndex}}
        onPress={() => onSelect(command)} style={[s.row, index === activeIndex && s.selected]}>
        <Text style={s.name}>/{command.name}</Text>
        {command.description ? <Text numberOfLines={1} style={[s.description, index === activeIndex && s.selectedText]}>{command.description}</Text> : null}
        <Text style={s.source}>{command.source === 'builtin' ? 'Pi/built-in' : `${command.source}/${command.sourceInfo.scope}`}</Text>
      </Pressable>)}
      {onManageTemplates ? <Pressable accessibilityRole="button" onPress={onManageTemplates}
        onHoverIn={() => setFooterHovered(true)} onHoverOut={() => setFooterHovered(false)}
        style={[s.row, s.footer, footerHovered && s.selected]}>
        <Icon name="sparkle" size={12} color={footerHovered ? s.name.color : s.description.color} />
        <Text numberOfLines={1} style={[s.description, footerHovered && s.selectedText]}>No prompt templates yet — add starters in Settings → Templates</Text>
      </Pressable> : null}
    </ScrollView>
  </View>;
}

export function ComposerSlotHint({activeIndex, count, onNext}: {activeIndex: number; count: number; onNext: () => void}) {
  const s = useThemeStyles(makeStyles);
  const [hovered, setHovered] = useState(false);
  return <Pressable {...tid('slot-hint')} {...{enableFocusRing: true}} accessibilityRole="button" accessibilityLabel={`Template slot ${activeIndex + 1} of ${count}, next slot`}
    onPress={onNext} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[s.hint, hovered && s.selected]}>
    <Text style={[s.hintText, hovered && s.selectedText]}>slot {activeIndex + 1}/{count} · ⇥ next · esc done</Text>
  </Pressable>;
}
const makeStyles = (palette: Palette) => StyleSheet.create({
  menu: {position: 'absolute', bottom: '100%', left: 12, marginBottom: 4, width: 448, maxWidth: '90%', borderRadius: 6, borderWidth: 1,
    borderColor: palette.border, backgroundColor: palette.elevated, zIndex: 35, shadowColor: '#000000', shadowOffset: {width: 0, height: 4}, shadowRadius: 8, shadowOpacity: palette.mediumShadowOpacity},
  content: {padding: 4}, row: {flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4},
  name: {fontFamily: 'JetBrains Mono', fontSize: 13, lineHeight: 20.8, color: palette.text},
  description: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.muted, flexShrink: 1},
  source: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.muted, marginLeft: 'auto'},
  selected: {backgroundColor: palette.hover}, selectedText: {color: palette.text},
  footer: {borderTopWidth: 1, borderColor: palette.border},
  hint: {position: 'absolute', bottom: '100%', left: 12, marginBottom: 4, zIndex: 35, borderWidth: 1, borderColor: palette.border, borderRadius: 4,
    paddingHorizontal: 8, paddingVertical: 4, backgroundColor: palette.elevated, shadowColor: '#000000', shadowOffset: {width: 0, height: 4}, shadowRadius: 8, shadowOpacity: palette.mediumShadowOpacity},
  hintText: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.muted},
});
