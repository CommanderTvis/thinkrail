import {useEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import {View} from 'react-native-macos';
import {ANALYTICS_DESCRIPTION, AnalyticsSharingSwitch} from './AnalyticsPreferences';
import {useAnalyticsConsent} from './useAnalyticsConsent';
import {Icon} from './Icon';
import {PrimaryButton} from './PrimaryButton';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {tid} from './testId';

export function AnalyticsConsentDialog() {
  const s = useStyles();
  const [draft, setDraft] = useState(true);
  const primed = useRef(false);
  const {pending, error, save, prime} = useAnalyticsConsent();
  useEffect(() => {
    if (primed.current) return;
    primed.current = true;
    prime();
  }, [prime]);
  const [hovered, setHovered] = useState('');
  return <View style={s.overlay} keyDownEvents={[{key: 'Escape'}]} onKeyDown={event => {
    if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); save(draft);}
  }}>
    <Pressable {...tid('dialog-overlay')} style={s.backdrop} onPress={() => save(draft)} />
    <View {...tid('analytics-consent-dialog')} style={s.dialog}>
      <View style={s.header}>
        <Text style={s.title}>Help improve ThinkRail</Text>
        <Text style={s.description}>{ANALYTICS_DESCRIPTION}</Text>
      </View>
      <Pressable {...tid('analytics-consent-close')} accessibilityRole="button" accessibilityLabel="Dismiss analytics choice" onPress={() => save(draft)}
          onHoverIn={() => setHovered('close')} onHoverOut={() => setHovered('')}
          style={[s.close, hovered === 'close' && s.hovered]}>
          <Icon name="close" color={hovered === 'close' ? color.text : color.muted} size={16} />
      </Pressable>
      <AnalyticsSharingSwitch enabled={draft} disabled={pending} onChange={next => {
        setDraft(next);
        if (!next) save(false);
      }} autoFocus />
      {error ? <View {...tid('analytics-consent-error')}><Text accessibilityRole="alert" style={s.error}>{error}</Text></View> : null}
      <View style={s.footer}>
        <PrimaryButton {...tid('analytics-consent-confirm', {disabled: pending})} disabled={pending} onPress={() => save(draft)} label={pending ? 'Saving…' : 'Done'} />
      </View>
    </View>
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  overlay: {...StyleSheet.absoluteFillObject, zIndex: 30, alignItems: 'center', justifyContent: 'center'},
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.5)'},
  dialog: {width: 448, maxWidth: '100%', padding: 16, gap: 16, borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 8, backgroundColor: palette.elevated,
    shadowColor: '#000000', shadowOffset: {width: 0, height: 8}, shadowRadius: 14, shadowOpacity: palette.dialogShadowOpacity},
  header: {gap: 4},
  close: {position: 'absolute', right: 12, top: 12, width: 24, height: 24, borderRadius: 4, alignItems: 'center', justifyContent: 'center'},
  title: {fontFamily: 'Geist SemiBold', fontSize: 14, lineHeight: 17.5, color: palette.text},
  description: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.muted},
  hovered: {backgroundColor: palette.hover},
  error: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.red},
  footer: {flexDirection: 'row', justifyContent: 'flex-end'},
});

const useStyles = () => useThemeStyles(makeStyles);
