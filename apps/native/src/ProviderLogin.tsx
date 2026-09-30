import {useEffect, useRef, useState} from 'react';
import {Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput} from 'react-native';
import {View} from 'react-native-macos';
import {hostClient} from './HostClient';
import type {LoginState} from './providerLoginState';
import {Icon} from './Icon';
import {PrimaryButton} from './PrimaryButton';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {tid} from './testId';
import {SecureTextField} from './SecureTextField';

function Button({label, onPress, disabled = false, option = false, testID}: {label: string; onPress: () => void; disabled?: boolean; option?: boolean; testID?: string; accessible?: boolean}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  return <Pressable testID={testID} accessibilityRole="button" accessibilityState={{disabled}} onPress={onPress} disabled={disabled}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[option ? s.option : s.button, hovered && s.hovered, disabled && s.disabled]}>
    <Text style={[s.buttonText, disabled && s.disabledText]}>{label}</Text>
  </Pressable>;
}

function Progress({message}: {message: string}) {
  const s = useStyles();
  const [rotation] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = Animated.loop(Animated.timing(rotation, {toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true, isInteraction: false}));
    animation.start();
    return () => animation.stop();
  }, [rotation]);
  return <View style={s.statusRow}>
    <Animated.View style={{transform: [{rotate: rotation.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']})}]}}>
      <Icon name="loader" color={color.muted} size={16} />
    </Animated.View><Text style={s.hint}>{message}</Text>
  </View>;
}

export function ProviderLogin({login, providerName}: {login: LoginState; providerName: string}) {
  const s = useStyles();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const openedUri = useRef<string | undefined>(undefined);
  const [error, setError] = useState('');
  const [hoveredClose, setHoveredClose] = useState(false);
  useEffect(() => setDraft(''), [login.input]);
  const reply = async (value: string) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {await hostClient.replyProviderLogin(value);}
    catch (reason) {setError(String(reason));}
    finally {submitting.current = false; setBusy(false);}
  };
  const openURL = (url: string) => Linking.openURL(url).catch(reason => setError(String(reason)));
  const deviceUri = login.deviceCode?.verificationUri;
  useEffect(() => {
    if (!deviceUri || openedUri.current === deviceUri) return;
    openedUri.current = deviceUri;
    Linking.openURL(deviceUri).catch(reason => setError(String(reason)));
  }, [deviceUri]);
  const close = () => {
    if (login.status === 'active') hostClient.cancelProviderLogin().catch(reason => setError(String(reason)));
    else hostClient.clearProviderLogin();
  };
  const input = login.input;
  const url = login.url;
  const deviceCode = login.deviceCode;
  return <View style={s.overlay} accessibilityViewIsModal keyDownEvents={[{key: 'Escape'}]} onKeyDown={event => {
    if (event.nativeEvent.key === 'Escape') {event.stopPropagation(); close();}
  }}>
    <Pressable style={s.backdrop} onPress={close} />
    <View {...tid('login-dialog', {provider: login.providerId})} style={s.dialog}>
      <ScrollView style={s.scroll} contentContainerStyle={s.body}>
        <View style={s.header}><Text style={s.title}>{login.status === 'success' ? `${providerName} connected`
          : login.status === 'error' ? "Couldn't connect" : `Connect ${providerName}`}</Text>
          {login.instructions && login.status === 'active' ? <Text style={s.hint}>{login.instructions}</Text> : null}
        </View>
        {login.status === 'success' ? <View {...tid('login-success')} style={s.statusRow}><Icon name="check" color={color.success} size={16} />
          <Text style={s.success}>{providerName} is connected.</Text></View>
          : login.status === 'error' ? <View {...tid('login-error')} style={s.errorRow}><View style={s.errorIcon}><Icon name="alertWarning" color={color.red} size={16} /></View>
            <Text selectable style={[s.error, s.statusCopy]}>{login.error ?? 'Login failed.'}</Text></View>
          : <View style={s.content}>
            {url ? <View style={s.step}><PrimaryButton label="Open sign-in page" icon="externalLink" iconSize={16} onPress={() => openURL(url)} />
              <Text selectable style={s.url}>{url}</Text></View> : null}
            {deviceCode ? <View style={s.deviceCode}>
              <Text style={s.metadata}>Enter this code at <Text accessibilityRole="link" onPress={() => openURL(deviceCode.verificationUri)} style={s.link}>
                {deviceCode.verificationUri} <Icon name="externalLink" color={color.accent} size={12} /></Text></Text>
              <Text selectable style={s.code}>{deviceCode.userCode}</Text>
            </View> : null}
            {input?.kind === 'select' ? <View style={s.step}>
              {input.message ? <Text style={s.hint}>{input.message}</Text> : null}
              {input.options.map(option => <Button {...tid('login-option')} key={option.id} label={option.label} option onPress={() => reply(option.id)} disabled={busy} />)}
            </View> : null}
            {input?.kind === 'prompt' ? <View style={s.step}>
              {input.message ? <Text style={s.hint}>{input.message}</Text> : null}
              <View style={s.inputRow}>{input.secret
                ? <SecureTextField {...tid('login-input')} autoFocus value={draft} onChangeText={setDraft} textColor={color.text} fontSize={14}
                  accessibilityLabel={input.message || 'Provider login response'} placeholder={input.placeholder ?? ''} style={s.input}
                  onSubmitEditing={() => {if (draft.trim() || input.allowEmpty) reply(draft.trim());}} />
                : <TextInput {...tid('login-input')} autoFocus value={draft} onChangeText={setDraft}
                  accessibilityLabel={input.message || 'Provider login response'} placeholder={input.placeholder ?? ''} placeholderTextColor={color.muted} style={s.input}
                  onSubmitEditing={() => {if (draft.trim() || input.allowEmpty) reply(draft.trim());}} />}
                <PrimaryButton {...tid('login-submit')} label="Submit" onPress={() => reply(draft.trim())} disabled={busy || (!draft.trim() && !input.allowEmpty)} />
              </View></View> : null}
            {login.progress ? <Progress message={login.progress} /> : null}
            {!url && !deviceCode && !input && !login.progress ? <Progress message="Working…" /> : null}
          </View>}
        {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
        <View style={s.footer}><Button {...tid(login.status === 'active' ? 'login-cancel' : 'login-close')} label={login.status === 'active' ? 'Cancel' : 'Done'} onPress={close} /></View>
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Close provider login" onPress={close}
        onHoverIn={() => setHoveredClose(true)} onHoverOut={() => setHoveredClose(false)} style={[s.close, hoveredClose && s.hovered]}>
        <Icon name="close" size={16} color={hoveredClose ? color.text : color.muted} />
      </Pressable>
    </View>
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  overlay: {...StyleSheet.absoluteFillObject, zIndex: 40, alignItems: 'center', justifyContent: 'center'},
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.5)'},
  dialog: {width: 448, maxWidth: '100%', maxHeight: '85%', backgroundColor: palette.elevated, borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 8,
    shadowColor: '#000000', shadowOffset: {width: 0, height: 8}, shadowRadius: 14, shadowOpacity: palette.dialogShadowOpacity},
  scroll: {flexGrow: 0, borderRadius: 8}, body: {padding: 16, gap: 16}, header: {gap: 4},
  title: {fontFamily: 'Geist SemiBold', color: palette.text, fontSize: 14, lineHeight: 17.5}, content: {gap: 12}, step: {gap: 4},
  hint: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 14, lineHeight: 20, flexShrink: 1},
  metadata: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12, lineHeight: 16},
  url: {fontFamily: 'JetBrains Mono', color: palette.muted, fontSize: 13, lineHeight: 20.8, backgroundColor: palette.input, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4},
  link: {color: palette.accent, textDecorationLine: 'underline'},
  deviceCode: {gap: 4, padding: 12, backgroundColor: palette.input, borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 4},
  code: {color: palette.text, fontSize: 18, lineHeight: 24, fontFamily: 'JetBrains Mono', letterSpacing: 1.8, textAlign: 'center'},
  inputRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  input: {fontFamily: 'Geist Native Text', flex: 1, height: 32, borderWidth: 1, borderColor: palette.border, borderRadius: 4, backgroundColor: palette.input,
    color: palette.text, fontSize: 14, lineHeight: 20, paddingHorizontal: 8, paddingVertical: 4},
  button: {height: 32, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.input, borderRadius: 4, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center'},
  option: {borderWidth: 1, borderColor: palette.border, backgroundColor: palette.input, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8},
  buttonText: {fontFamily: 'Geist Native Text', color: palette.text, fontSize: 14, lineHeight: 20}, hovered: {backgroundColor: palette.hover},
  disabled: {backgroundColor: `${palette.input}99`, borderColor: `${palette.border}99`}, disabledText: {color: palette.disabledText},
  footer: {flexDirection: 'row', justifyContent: 'flex-end'}, statusRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  errorRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 8}, errorIcon: {marginTop: 2}, statusCopy: {flex: 1},
  close: {position: 'absolute', right: 12, top: 12, width: 24, height: 24, borderRadius: 4, alignItems: 'center', justifyContent: 'center'},
  success: {fontFamily: 'Geist Native Text', color: palette.success, fontSize: 14, lineHeight: 20},
  error: {fontFamily: 'Geist Native Text', color: palette.red, fontSize: 14, lineHeight: 20},
});

const useStyles = () => useThemeStyles(makeStyles);
