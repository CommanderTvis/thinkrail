import {useEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {isJbcentralQuotaRefreshSeconds, JBCENTRAL_QUOTA_REFRESH_SECONDS} from '../../../packages/contracts/src';
import {hostClient, useHostClient} from './HostClient';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';

export function CentralQuotaSettings() {
  const s = useThemeStyles(makeStyles);
  const {config} = useHostClient();
  const [draft, setDraft] = useState(String(config?.jbcentralQuotaRefreshSeconds ?? JBCENTRAL_QUOTA_REFRESH_SECONDS.default));
  const [error, setError] = useState('');
  const input = useRef<TextInput>(null);
  const busy = useRef(false);
  useEffect(() => setDraft(String(config?.jbcentralQuotaRefreshSeconds ?? JBCENTRAL_QUOTA_REFRESH_SECONDS.default)), [config?.jbcentralQuotaRefreshSeconds]);
  if (!config) return null;
  const enabled = config.jbcentralQuotaEnabled;
  const saveInterval = async () => {
    const seconds = Number(draft);
    if (!isJbcentralQuotaRefreshSeconds(seconds)) {setError('Enter a whole number from 1 to 3600.'); return;}
    if (seconds === config.jbcentralQuotaRefreshSeconds) {setError(''); return;}
    if (busy.current) return;
    busy.current = true;
    try {
      if (await hostClient.updateConfig({jbcentralQuotaRefreshSeconds: seconds})) setError('');
      else {setDraft(String(config.jbcentralQuotaRefreshSeconds)); setError("Couldn't save the refresh interval.");}
    } finally {busy.current = false;}
  };
  return <View style={s.section}>
    <View style={s.toggleRow}><View style={s.copy}><Text style={s.ui}>Show quota in top bar</Text>
      <Text style={s.metadata}>Display recurring JetBrains AI credits while Central is connected.</Text></View>
      <Pressable accessibilityRole="switch" accessibilityLabel="Show JetBrains AI quota in top bar" accessibilityState={{checked: enabled}}
        onPress={async () => {setError(''); if (!await hostClient.updateConfig({jbcentralQuotaEnabled: !enabled})) setError("Couldn't save the quota display setting.");}}
        style={[s.track, enabled && s.trackOn]}><View style={[s.thumb, enabled && s.thumbOn]} /></Pressable>
    </View>
    <View style={s.intervalRow}><Text style={s.metadata}>Refresh every</Text>
      <TextInput ref={input} value={draft} editable={enabled} accessibilityLabel="JetBrains AI quota refresh interval in seconds"
        accessibilityState={{disabled: !enabled}} placeholderTextColor={color.muted}
        onChangeText={value => {setDraft(value); setError('');}} onBlur={saveInterval} onSubmitEditing={() => input.current?.blur()}
        style={[s.input, !enabled && s.disabledInput]} />
      <Text style={s.metadata}>seconds</Text><Text style={[s.metadata, s.range]}>1–3600</Text>
    </View>
    {error ? <Text accessibilityRole="alert" style={[s.metadata, s.error]}>{error}</Text> : null}
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  section: {gap: 8, borderTopWidth: 1, borderColor: palette.border, paddingTop: 12},
  toggleRow: {flexDirection: 'row', alignItems: 'center', gap: 12}, copy: {flex: 1},
  ui: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.text},
  metadata: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.muted},
  track: {width: 36, height: 20, padding: 2, borderRadius: 10, backgroundColor: palette.borderStrong},
  trackOn: {backgroundColor: palette.accent}, thumb: {width: 16, height: 16, borderRadius: 8, backgroundColor: palette.bg}, thumbOn: {alignSelf: 'flex-end'},
  intervalRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  input: {width: 80, height: 30, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.input, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 4, fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.text},
  disabledInput: {borderColor: `${palette.border}99`, backgroundColor: `${palette.input}99`, color: palette.disabledText},
  range: {marginLeft: 'auto', color: palette.hint}, error: {color: palette.red},
});
