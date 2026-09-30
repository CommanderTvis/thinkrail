import {Pressable, StyleSheet, Text, View} from 'react-native';
import {Icon} from './Icon';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {tid} from './testId';
import {dismissToast, useToasts} from './toast';

export function Toaster() {
  const s = useThemeStyles(makeStyles);
  const toasts = useToasts();
  if (!toasts.length) return null;
  return <View pointerEvents="box-none" style={s.viewport}>
    {toasts.map(item => <View key={item.id} {...tid('toast', {variant: item.variant})} accessibilityRole="alert"
      style={[s.toast, item.variant === 'error' && s.error]}>
      <View style={s.copy}>
        {item.title ? <Text style={s.title}>{item.title}</Text> : null}
        <Text selectable style={s.message}>{item.message}</Text>
      </View>
      <Pressable {...tid('toast-close')} accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => dismissToast(item.id)} style={s.close}>
        <Icon name="close" color={color.muted} size={14} />
      </Pressable>
    </View>)}
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  viewport: {position: 'absolute', right: 16, bottom: 16, width: 360, gap: 8, zIndex: 60},
  toast: {flexDirection: 'row', gap: 8, padding: 12, borderWidth: 1, borderRadius: 6, borderColor: palette.borderStrong, backgroundColor: palette.elevated},
  error: {borderLeftWidth: 3, borderLeftColor: palette.red},
  copy: {flex: 1, gap: 4},
  title: {fontFamily: 'Geist SemiBold', fontSize: 13, color: palette.text},
  message: {fontFamily: 'Geist Native Text', fontSize: 13, lineHeight: 18, color: palette.muted},
  close: {width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 4},
});
