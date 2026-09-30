import {useEffect, useRef} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {tid} from './testId';

export const ANALYTICS_DESCRIPTION =
  'Share anonymous product usage and how you found ThinkRail. We never collect prompts, code, files, credentials, or account identity.';

type PreferenceProps = {enabled: boolean; disabled: boolean; onChange: (enabled: boolean) => void};

export function AnalyticsSharingSwitch({enabled, disabled, onChange, description, autoFocus = false}: PreferenceProps & {
  description?: string; autoFocus?: boolean;
}) {
  const s = useThemeStyles(makeStyles);
  const button = useRef<View>(null);
  useEffect(() => {if (autoFocus) button.current?.focus();}, [autoFocus]);
  return <View style={s.row}>
    <View style={s.copy}><Text style={s.label}>Share additional usage data</Text>
      {description ? <Text style={s.metadata}>{description}</Text> : null}</View>
    <Pressable ref={button} {...tid('analytics-toggle', {active: enabled})} disabled={disabled} onPress={() => onChange(!enabled)} accessibilityLabel="Share additional usage data"
      accessibilityRole="switch" accessibilityState={{checked: enabled, disabled}}
      style={[s.track, enabled && s.trackOn, disabled && s.disabled]}>
      <View style={[s.thumb, enabled && s.thumbOn]} />
    </Pressable>
  </View>;
}

export function AnalyticsPreferences(props: PreferenceProps) {
  const s = useThemeStyles(makeStyles);
  return <View style={s.preferences}>
    <AnalyticsSharingSwitch {...props} description="Setup, agent runs, task completions, reviews, and pull-request outcomes." />
    <Text style={s.metadata}>Reports use a random installation ID, app type, version and channel, OS, and architecture. Custom providers and models are labeled “custom”. No prompts, code, transcripts, file paths, credentials, or recordings.</Text>
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  preferences: {gap: 16}, row: {borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 4, backgroundColor: palette.input,
    paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12},
  copy: {flex: 1, gap: 4}, label: {fontFamily: 'Geist Medium', fontSize: 12, lineHeight: 19.2, color: palette.text},
  metadata: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.muted},
  track: {width: 36, height: 20, borderRadius: 10, backgroundColor: palette.borderStrong, padding: 2},
  trackOn: {backgroundColor: palette.accent}, thumb: {width: 16, height: 16, borderRadius: 8, backgroundColor: palette.bg},
  thumbOn: {alignSelf: 'flex-end'}, disabled: {opacity: 0.5},
});
