import {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {View as MacView} from 'react-native-macos';
import {useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {tid} from './testId';

function Action({label, testId, destructive, onPress}: {label: string; testId?: string; destructive?: boolean; onPress: () => void}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <Pressable {...(testId ? tid(testId) : {})} accessibilityRole="button" onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[s.button, hovered && s.hovered]}>
    <Text style={destructive ? s.destructive : s.label}>{label}</Text>
  </Pressable>;
}

export function ConfirmDialog({title, description, confirmLabel, confirmTestId, onConfirm, onCancel}: {
  title: string; description: string; confirmLabel: string; confirmTestId: string; onConfirm: () => void; onCancel: () => void;
}) {
  const s = useStyles();
  return <MacView style={s.layer} keyDownEvents={[{key: 'Escape'}]} onKeyDown={event => {
    if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); onCancel();}
  }}>
    <Pressable {...tid('dialog-overlay')} style={s.backdrop} onPress={onCancel} />
    <View {...tid('confirm-dialog')} accessibilityRole="alert" style={s.dialog}>
      <Text style={s.title}>{title}</Text>
      <Text style={s.body}>{description}</Text>
      <View style={s.actions}>
        <Action label="Cancel" testId="confirm-cancel" onPress={onCancel} />
        <Action label={confirmLabel} testId={confirmTestId} destructive onPress={onConfirm} />
      </View>
    </View>
  </MacView>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  layer: {...StyleSheet.absoluteFillObject, zIndex: 40, alignItems: 'center', justifyContent: 'center'},
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: '#00000088'},
  dialog: {width: 400, padding: 20, gap: 14, borderRadius: 8, backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.borderStrong},
  title: {fontFamily: 'Geist SemiBold', color: palette.text, fontSize: 17},
  body: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 14, lineHeight: 21},
  actions: {flexDirection: 'row', justifyContent: 'flex-end', gap: 8},
  button: {paddingHorizontal: 12, paddingVertical: 7, borderRadius: 4, borderWidth: 1, borderColor: palette.borderStrong},
  hovered: {backgroundColor: palette.hover},
  label: {fontFamily: 'Geist Native Text', fontSize: 13, color: palette.text},
  destructive: {fontFamily: 'Geist Native Text', fontSize: 13, color: palette.red},
});

const useStyles = () => useThemeStyles(makeStyles);
