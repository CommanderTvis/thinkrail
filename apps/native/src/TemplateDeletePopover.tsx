import {useEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, type View as NativeView} from 'react-native';
import {View} from 'react-native-macos';
import {hostClient, type TemplateInfo} from './HostClient';
import {Icon} from './Icon';
import {TemplateButton} from './TemplatesSettings';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {templatePopoverPlacement} from './templateModel';

export type TemplateDelete = {template: TemplateInfo; button: NativeView; anchor: {x: number; y: number; width: number; height: number}; bounds: {width: number; height: number}};
export function TemplateDeletePopover({target, workspaceId, onClose, onDeleted}: {
  target: TemplateDelete; workspaceId?: string; onClose: () => void; onDeleted: () => void;
}) {
  const s = useThemeStyles(makeStyles);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [height, setHeight] = useState(138);
  const placement = templatePopoverPlacement(target.anchor, target.bounds, height);
  const remove = async () => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError('');
    try {await hostClient.deleteTemplate(target.template, workspaceId); if (mounted.current) {onDeleted(); onClose();}}
    catch (reason) {if (mounted.current) setError(String(reason));}
    finally {busy.current = false; if (mounted.current) setPending(false);}
  };
  return <View style={s.overlay} keyDownEvents={[{key: 'Escape'}]} onKeyDown={event => {
    if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); onClose();}
  }}>
    <Pressable style={s.scrim} onPress={onClose} />
    <View onLayout={event => setHeight(event.nativeEvent.layout.height)} style={[s.popover, placement]} accessibilityRole="alert" accessibilityLabel={`Delete ${target.template.name}?`} accessibilityViewIsModal>
      <View style={s.heading}><Icon name="alertWarning" size={16} color={color.red} /><Text style={s.title}>Delete {target.template.name}?</Text></View>
      <Text style={s.metadata}>Removes the template file. This can't be undone.</Text>
      {error ? <Text accessibilityRole="alert" style={[s.metadata, s.error]}>{error}</Text> : null}
      <View style={s.actions}><TemplateButton autoFocus label="Cancel" onPress={onClose} />
        <Pressable {...{enableFocusRing: true}} accessibilityRole="button" accessibilityLabel="Delete template" accessibilityState={{disabled: pending, busy: pending}} disabled={pending} onPress={remove}
          onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[s.delete, hovered && s.deleteHovered, pending && s.disabled]}>
          <Text style={[s.deleteText, pending && s.disabledText]}>Delete</Text></Pressable></View>
    </View>
  </View>;
}
const makeStyles = (palette: Palette) => StyleSheet.create({
  overlay: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 55},
  scrim: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0},
  popover: {position: 'absolute', width: 288, padding: 12, gap: 8, borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 4,
    backgroundColor: palette.elevated, shadowColor: '#000000', shadowOffset: {width: 0, height: 4}, shadowRadius: 8, shadowOpacity: 0.2},
  heading: {flexDirection: 'row', alignItems: 'center', gap: 8},
  title: {fontFamily: 'Geist Medium', fontSize: 14, lineHeight: 20, color: palette.text, flexShrink: 1},
  metadata: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.muted},
  actions: {flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 4},
  delete: {height: 28, paddingHorizontal: 8, borderRadius: 4, backgroundColor: palette.red, justifyContent: 'center'},
  deleteText: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.onAccent}, error: {color: palette.red},
  deleteHovered: {opacity: 0.9}, disabled: {backgroundColor: palette.hover, opacity: 1}, disabledText: {color: palette.disabledText},
});
