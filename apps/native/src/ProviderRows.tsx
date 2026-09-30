import {useEffect, useState} from 'react';
import {Animated, Easing, Pressable, StyleSheet, Text, View} from 'react-native';
import type {ProviderStatus} from './HostClient';
import {providerAuthLabel} from './providerPresentation';
import {Icon, type IconName} from './Icon';
import {PrimaryButton} from './PrimaryButton';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {tid} from './testId';

export function ProviderButton({label, icon, onPress, disabled = false, ghost = false, spinning = false, testID}: {
  testID?: string; accessible?: boolean; label: string; icon?: IconName; onPress: () => void; disabled?: boolean; ghost?: boolean; spinning?: boolean;
}) {
  const s = useStyles();
  const [hovered, setHovered] = useState(false);
  const [rotation] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!spinning) {rotation.setValue(0); return;}
    const animation = Animated.loop(Animated.timing(rotation, {toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true, isInteraction: false}));
    animation.start(); return () => animation.stop();
  }, [rotation, spinning]);
  const tint = disabled ? color.disabledText : ghost && !hovered ? color.muted : color.text;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={icon === 'refresh' ? 'Refresh provider status' : label}
    accessibilityState={{disabled, busy: spinning}} onPress={onPress} disabled={disabled}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[s.button, !ghost && s.outline, hovered && s.hovered, disabled && !ghost && s.disabled]}>
    {icon ? <Animated.View style={{transform: [{rotate: rotation.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']})}]}}>
      <Icon name={icon} size={14} color={tint} /></Animated.View> : null}
    <Text style={[s.ui, ghost && !hovered && s.muted, disabled && s.disabledText]}>{label}</Text>
  </Pressable>;
}

export function ProviderRow({provider, busy, onSignOut, onSignIn, onApiKey}: {
  provider: ProviderStatus; busy: boolean; onSignOut: () => void; onSignIn: () => void; onApiKey: () => void;
}) {
  const s = useStyles();
  return <View {...tid(provider.configured ? 'provider-row' : 'provider-signin-row', {provider: provider.id, configured: provider.configured})}
    style={[s.row, provider.configured ? s.connectedRow : s.actionRow]}>
    <View style={[s.badge, provider.configured && s.successBadge]}>
      <Icon name={provider.configured ? 'check' : 'stack'} size={16} color={provider.configured ? color.success : color.muted} /></View>
    <View style={s.copy}><Text numberOfLines={1} style={s.ui}>{provider.name}</Text>
      {provider.configured ? <Text numberOfLines={1} style={s.metadata}>{providerAuthLabel(provider.kind)}{provider.detail ? ` · ${provider.detail}` : ''}</Text> : null}</View>
    {provider.configured ? provider.canLogout
      ? <ProviderButton {...tid('provider-signout', {provider: provider.id})} label="Sign out" icon="logout" disabled={busy} onPress={onSignOut} />
      : <View style={s.managed} accessibilityLabel={provider.kind === 'central' ? 'Connected through JetBrains AI' : 'Configured outside the app (environment / models.json)'}>
        <Icon name="lock" size={12} color={color.muted} /><Text style={s.metadata}>Managed</Text></View>
      : <View style={s.actions}>
        {provider.canApiKey ? provider.canOAuth
          ? <ProviderButton {...tid('provider-apikey', {provider: provider.id})} label="API key" icon="key" disabled={busy} onPress={onApiKey} />
          : <PrimaryButton {...tid('provider-apikey', {provider: provider.id})} small label="API key" icon="key" disabled={busy} onPress={onApiKey} /> : null}
        {provider.canOAuth ? <PrimaryButton {...tid('provider-signin', {provider: provider.id})} small label="Sign in" icon="login" disabled={busy} onPress={onSignIn} /> : null}
      </View>}
  </View>;
}

export function ProviderSkeleton({label = 'Loading provider status'}: {label?: string}) {
  const s = useStyles();
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, {toValue: 0.5, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true, isInteraction: false}),
      Animated.timing(opacity, {toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true, isInteraction: false}),
    ]));
    animation.start(); return () => animation.stop();
  }, [opacity]);
  return <View style={s.skeleton} accessibilityLabel={label} accessibilityState={{busy: true}}>
    {[s.skeletonFirst, s.skeletonSecond, s.skeletonThird].map((width, index) => <Animated.View key={index} style={[s.skeletonRow, width, {opacity}]} />)}
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: palette.input},
  connectedRow: {gap: 12}, actionRow: {gap: 8}, badge: {width: 32, height: 32, borderRadius: 4, backgroundColor: palette.hover, alignItems: 'center', justifyContent: 'center'},
  successBadge: {backgroundColor: `${palette.success}1f`}, copy: {flex: 1}, actions: {flexDirection: 'row', alignItems: 'center', gap: 4},
  managed: {flexDirection: 'row', alignItems: 'center', gap: 4},
  ui: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.text},
  metadata: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.muted}, muted: {color: palette.muted},
  button: {height: 28, paddingHorizontal: 8, borderRadius: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8},
  outline: {borderWidth: 1, borderColor: palette.border, backgroundColor: palette.input}, hovered: {backgroundColor: palette.hover},
  disabled: {backgroundColor: `${palette.input}99`, borderColor: `${palette.border}99`}, disabledText: {color: palette.disabledText},
  skeleton: {gap: 8}, skeletonRow: {height: 3, borderRadius: 4, backgroundColor: palette.hover},
  skeletonFirst: {width: '75%'}, skeletonSecond: {width: '50%'}, skeletonThird: {width: '83.333333%'},
});
const useStyles = () => useThemeStyles(makeStyles);
