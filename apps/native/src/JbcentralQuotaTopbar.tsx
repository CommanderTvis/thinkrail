import {useEffect, useRef, useState} from 'react';
import {AppState, Pressable, StyleSheet, Text} from 'react-native';
import {View} from 'react-native-macos';
import {isJbcentralConnected} from '../../../packages/contracts/src';
import {hostClient, type ClientState} from './HostClient';
import {Icon} from './Icon';
import {SpinningIcon} from './SpinningIcon';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';
import {formatJbcentralQuota, quotaTransportFailure, startJbcentralQuotaPolling, type JbcentralQuotaPolling, type QuotaViewSnapshot} from './jbcentralQuota';

export function JbcentralQuotaTopbar({state}: {state: ClientState}) {
  const [visible, setVisible] = useState(AppState.currentState !== 'background');
  const [snapshot, setSnapshot] = useState<QuotaViewSnapshot>({state: 'hidden'});
  const pollingRef = useRef<JbcentralQuotaPolling | null>(null);
  const enabled = state.config?.jbcentralQuotaEnabled ?? false;
  const refreshSeconds = state.config?.jbcentralQuotaRefreshSeconds ?? 30;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => setVisible(next !== 'background'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let current = true;
    setSnapshot({state: 'hidden'});
    if (visible && enabled && state.connection === 'connected') {
      hostClient.providerStatus().then(report => {
        if (!current || !isJbcentralConnected(report.jbcentral)) return;
        setSnapshot({state: 'loading'});
        pollingRef.current = startJbcentralQuotaPolling({
          intervalMs: refreshSeconds * 1000,
          request: force => hostClient.jbcentralQuota(force),
          onSnapshot: setSnapshot,
          onError: () => setSnapshot(quotaTransportFailure),
        });
      }).catch(() => {});
    }
    return () => {
      current = false;
      pollingRef.current?.stop();
      pollingRef.current = null;
    };
  }, [visible, enabled, refreshSeconds, state.connection, state.providerRevision]);

  return <QuotaIndicator snapshot={snapshot} onRetry={() => pollingRef.current?.retry()} />;
}

function QuotaIndicator({snapshot, onRetry}: {snapshot: QuotaViewSnapshot; onRetry: () => void}) {
  const s = useThemeStyles(makeStyles);
  const [hovered, setHovered] = useState(false);
  if (snapshot.state === 'hidden') return null;
  const loading = snapshot.state === 'loading';
  const unavailable = snapshot.state === 'unavailable';
  const stale = snapshot.state === 'stale';
  const loaded = snapshot.state === 'available' || snapshot.state === 'stale';
  const value = loaded ? formatJbcentralQuota(snapshot.remaining, snapshot.total) : '';
  const observed = loaded ? new Date(snapshot.observedAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit', second: '2-digit'}) : '';
  const tooltip = loading ? 'Reading recurring JetBrains AI quota'
    : unavailable ? 'Central is connected, but quota could not be read'
    : stale ? `Last successful quota read: ${observed} · Click to retry`
    : `Recurring JetBrains AI credits · Updated ${observed}`;
  const label = loaded ? `${value} recurring JetBrains AI credits${stale ? ', stale — retry' : `, updated ${observed}`}`
    : loading ? 'Loading quota…' : 'Quota unavailable · Retry';
  const content = <>
    {loading ? <SpinningIcon name="loader" size={14} color={color.muted} /> : <Icon name="coins" size={14} color={color.muted} />}
    <Text style={[s.text, (loading || (unavailable && !hovered)) && s.muted]}>{loaded ? value : loading ? 'Loading quota…' : 'Quota unavailable'}</Text>
    {loaded ? <Text style={s.text}>credits</Text> : unavailable ? <Text style={[s.text, !hovered && s.muted]}>· Retry</Text> : null}
    {stale ? <View style={s.staleDot} /> : null}
  </>;
  return <View {...{tooltip}} collapsable={false} style={s.container}>
    {stale || unavailable ? <Pressable {...{enableFocusRing: true}} accessibilityRole="button" accessibilityLabel={label} onPress={onRetry}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      style={s.row}>{content}</Pressable>
      : <View accessible accessibilityLabel={label} style={s.row}>{content}</View>}
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  container: {marginRight: 14, flexShrink: 0},
  row: {flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 4},
  text: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.text},
  muted: {color: palette.muted},
  staleDot: {width: 6, height: 6, borderRadius: 3, backgroundColor: palette.warning},
});
