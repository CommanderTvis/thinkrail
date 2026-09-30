import {useEffect, useRef, useState} from 'react';
import {Clipboard, Pressable, StyleSheet, Text, View} from 'react-native';
import type {JbcentralAction, JbcentralActionFailureReason, JbcentralInstall, JbcentralStatus} from '../../../packages/contracts/src';
import {hostClient} from './HostClient';
import {centralActionLabel, centralActions, centralFailureText, centralSignedOut, centralStatusBody} from './jbcentralPresentation';
import {Icon, type IconName} from './Icon';
import {PrimaryButton} from './PrimaryButton';
import {ProviderButton} from './ProviderRows';
import {SpinningIcon} from './SpinningIcon';
import {CentralQuotaSettings} from './CentralQuotaSettings';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {tid} from './testId';

type Notice = {kind: 'failed'; action: JbcentralAction; reason: JbcentralActionFailureReason}
  | {kind: 'transport-failed'; action: JbcentralAction} | {kind: 'login-launched' | 'login-failed'};

function CopyableCommand({command}: {command: string}) {
  const s = useStyles();
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timer = useRef({handle: undefined as ReturnType<typeof setTimeout> | undefined}).current;
  useEffect(() => () => {clearTimeout(timer.handle);}, [timer]);
  return <View style={s.commandRow}><Text selectable style={s.command}>{command}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`Copy: ${command}`} onPress={async () => {
      Clipboard.setString(command); if (await Clipboard.getString() !== command) return;
      setCopied(true); clearTimeout(timer.handle); timer.handle = setTimeout(() => setCopied(false), 1500);
    }} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={[s.copyButton, hovered && s.hovered]}>
      <Icon name={copied ? 'check' : 'copy'} color={copied ? color.success : hovered ? color.text : color.muted} size={14} />
    </Pressable></View>;
}

export function JetBrainsAiCard({status, install, onChanged}: {status: JbcentralStatus; install: JbcentralInstall; onChanged: () => void}) {
  const s = useStyles();
  const [busyAction, setBusyAction] = useState<JbcentralAction | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const actionBusy = useRef(false);
  const signInBusy = useRef(false);
  const demandedSignIn = useRef(centralSignedOut(status));
  useEffect(() => {
    if (status.state !== 'configuring') return;
    const timer = setInterval(onChanged, 500); return () => clearInterval(timer);
  }, [status.state, onChanged]);
  useEffect(() => {
    const signedOut = centralSignedOut(status);
    const resolved = demandedSignIn.current && !signedOut;
    demandedSignIn.current = signedOut;
    if (status.state === 'configured' || resolved) setNotice(current => current?.kind === 'login-launched' || current?.kind === 'login-failed' ? null : current);
  }, [status]);
  const runAction = async (action: JbcentralAction) => {
    if (actionBusy.current) return;
    actionBusy.current = true; setBusyAction(action); setNotice(null);
    try {
      const result = await hostClient.jbcentralAction(action);
      if (result.outcome === 'failed') setNotice({kind: 'failed', action, reason: result.reason});
      onChanged();
    } catch {setNotice({kind: 'transport-failed', action});}
    finally {actionBusy.current = false; setBusyAction(null);}
  };
  const signIn = async () => {
    if (signInBusy.current) return;
    signInBusy.current = true; setSigningIn(true);
    try {
      const result = await hostClient.jbcentralLogin();
      setNotice({kind: result.outcome === 'launched' ? 'login-launched' : 'login-failed'});
      if (result.outcome === 'launched') onChanged();
    } catch {setNotice({kind: 'login-failed'});}
    finally {signInBusy.current = false; setSigningIn(false);}
  };
  const body = centralStatusBody(status);
  const signedOut = centralSignedOut(status);
  const actionIcon: Record<JbcentralAction, IconName> = {connect: 'bard', disconnect: 'logout', 'start-proxy': 'play', update: 'tools'};
  const guidance = notice && (notice.kind === 'transport-failed' || notice.kind === 'failed') && !signedOut && notice.action === 'connect'
    && (notice.kind === 'transport-failed' || notice.reason === 'central-action-failed');
  return <View {...tid('jetbrains-ai-card', {state: busyAction ? 'configuring' : status.state, configured: status.state === 'configured', installed: status.state !== 'absent'})} style={s.card}>
    <View style={s.header}><View style={s.badge}><Icon name="bard" size={16} color={color.accent} /></View>
      <View style={s.copy}><Text style={s.ui}>JetBrains AI</Text><Text style={s.metadata}>Use models made available through your JetBrains subscription.</Text></View>
      <View style={s.actions}>{busyAction ? <PrimaryButton small disabled spinning icon="loader" label={`${centralActionLabel(busyAction)}…`} onPress={() => {}} />
        : centralActions(status).map(action => action === 'sign-in'
          ? <PrimaryButton {...tid('jetbrains-signin')} key={action} small icon={signingIn ? 'loader' : 'externalLink'} spinning={signingIn} disabled={signingIn} label="Sign in" onPress={signIn} />
          : action === 'recheck' ? <ProviderButton {...tid('jetbrains-recheck')} key={action} ghost icon="refresh" label="Recheck" onPress={onChanged} />
          : action === 'retry' ? <PrimaryButton {...tid('jetbrains-retry')} key={action} small icon="refresh" label="Retry" onPress={() => runAction(status.state === 'load-failed' && status.configured ? 'connect' : 'disconnect')} />
          : action === 'disconnect' ? <ProviderButton {...tid('jetbrains-disconnect')} key={action} icon="logout" label="Disconnect" onPress={() => runAction(action)} />
          : <PrimaryButton {...tid(`jetbrains-${action}`)} key={action} small icon={actionIcon[action]} label={centralActionLabel(action)} onPress={() => runAction(action)} />)}
      </View>
    </View>
    <View style={s.group}><View style={[s.statusRow, (body.icon === 'alertWarning') && s.statusWarning]}>
      {body.icon ? body.icon === 'loader' ? <SpinningIcon name="loader" color={color.muted} />
        : <View style={body.icon === 'alertWarning' && s.warningIcon}><Icon name={body.icon} size={14} color={color[body.tone]} /></View> : null}
      <Text style={[s.metadata, s.statusText, s[body.tone]]}>{body.text}</Text>
    </View>
    {status.state === 'absent' ? <View {...tid('jetbrains-needs-install')} style={s.group}><CopyableCommand command={install.command} />
      <View style={s.start}><ProviderButton {...tid('jetbrains-recheck')} ghost icon="refresh" label="Recheck" onPress={onChanged} /></View></View> : null}
    </View>
    {notice?.kind === 'failed' || notice?.kind === 'transport-failed' ? <View style={s.group}>
      <Text accessibilityRole="alert" style={[s.metadata, s.red]}>{notice.kind === 'failed' ? centralFailureText(notice.action, notice.reason)
        : "ThinkRail couldn't reach the host. Recheck the connection and try again."}</Text>
      {guidance ? <View style={s.group}><Text style={s.metadata}>If Central needs authentication, sign in and then retry Connect.</Text>
        <View style={s.start}><ProviderButton spinning={signingIn} disabled={signingIn} icon={signingIn ? 'loader' : 'externalLink'} label="Sign in to JetBrains" onPress={signIn} /></View></View> : null}
    </View> : null}
    {notice?.kind === 'login-launched' ? <Text style={s.metadata}>Complete sign-in in the browser on the host, then Refresh.</Text>
      : notice?.kind === 'login-failed' ? <View style={s.group}><Text accessibilityRole="alert" style={[s.metadata, s.red]}>ThinkRail couldn't launch Central sign-in. Run this on the host instead:</Text>
        <CopyableCommand command="central login" /></View> : null}
    <CentralQuotaSettings />
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  card: {gap: 8, padding: 12, borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 4, backgroundColor: palette.input},
  header: {flexDirection: 'row', alignItems: 'center', gap: 12}, badge: {width: 32, height: 32, borderRadius: 4, backgroundColor: palette.primarySubtle, alignItems: 'center', justifyContent: 'center'},
  copy: {flex: 1}, actions: {flexDirection: 'row', alignItems: 'center', gap: 4}, group: {gap: 4}, start: {alignSelf: 'flex-start'},
  ui: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.text},
  metadata: {fontFamily: 'Geist Native Text', fontSize: 12, lineHeight: 16, color: palette.muted},
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: 4}, statusWarning: {alignItems: 'flex-start'}, warningIcon: {marginTop: 2}, statusText: {flex: 1},
  muted: {color: palette.muted}, warning: {color: palette.warning}, success: {color: palette.success}, red: {color: palette.red},
  commandRow: {flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: palette.borderStrong, borderRadius: 4, backgroundColor: palette.bg, paddingHorizontal: 8, paddingVertical: 4},
  command: {flex: 1, fontFamily: 'JetBrains Mono', fontSize: 13, lineHeight: 20.8, color: palette.text},
  copyButton: {width: 24, height: 24, borderRadius: 4, alignItems: 'center', justifyContent: 'center'}, hovered: {backgroundColor: palette.hover},
});
const useStyles = () => useThemeStyles(makeStyles);
