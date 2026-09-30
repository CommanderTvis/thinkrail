import {useEffect, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, type View as NativeView} from 'react-native';
import {View} from 'react-native-macos';
import {Icon} from './Icon';
import {color, useThemeId, useThemeStyles} from './Theme';
import {themeChoices, type Palette, type ThemeId} from './themePalette';
import {themeMenuFocus, type ThemeMenuPlacement} from './themeMenuModel';

export function ThemeMenu({appearance, value, placement, onSelect, onDismiss}: {
  appearance: 'light' | 'dark'; value: ThemeId; placement: ThemeMenuPlacement;
  onSelect: (id: ThemeId) => void; onDismiss: () => void;
}) {
  const s = useThemeStyles(makeStyles);
  const light = useThemeId().includes('light');
  const choices = themeChoices.filter(theme => theme.appearance === appearance);
  const [focused, setFocused] = useState(Math.max(0, choices.findIndex(theme => theme.id === value)));
  const rows = useRef<(NativeView | null)[]>([]);
  useEffect(() => {rows.current[focused]?.focus();}, [focused]);
  return <View style={s.layer} keyDownEvents={['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].map(key => ({key}))}
    onKeyDown={event => {
      const key = event.nativeEvent.key;
      event.stopPropagation();
      if (key === 'Escape') onDismiss();
      else if (key === 'Enter' || key === ' ') onSelect(choices[focused].id);
      else {
        const next = themeMenuFocus(key, focused, choices.length);
        if (next !== null) setFocused(next);
      }
    }}>
    <Pressable accessibilityLabel="Dismiss theme menu" style={s.backdrop} onPress={onDismiss} />
    <View style={[s.menu, placement, light ? s.lightShadow : s.darkShadow]}>
      <ScrollView accessibilityRole="menu" accessibilityLabel={appearance === 'light' ? 'Light theme' : 'Dark theme'} contentContainerStyle={s.items}>
        {choices.map((theme, index) => <Pressable key={theme.id} ref={element => {rows.current[index] = element;}}
          accessibilityRole="radio" accessibilityState={{checked: theme.id === value}}
          onFocus={() => setFocused(index)} onHoverIn={() => setFocused(index)} onPress={() => onSelect(theme.id)}
          style={[s.item, index === focused && s.selected]}>
          <View style={s.check}>{theme.id === value ? <Icon name="check" color={color.accent} size={14} /> : null}</View>
          <Text numberOfLines={1} style={s.label}>{theme.label}</Text>
        </Pressable>)}
      </ScrollView>
    </View>
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  layer: {...StyleSheet.absoluteFillObject, zIndex: 10}, backdrop: {...StyleSheet.absoluteFillObject},
  menu: {position: 'absolute', borderWidth: 1, borderColor: palette.border, borderRadius: 6, backgroundColor: palette.elevated,
    shadowColor: '#000000', shadowOffset: {width: 0, height: 4}, shadowRadius: 16},
  lightShadow: {shadowOpacity: 0.12}, darkShadow: {shadowOpacity: 0.35},
  items: {padding: 4}, item: {flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4},
  selected: {backgroundColor: palette.hover}, check: {width: 14}, label: {flexShrink: 1, fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.text},
});
