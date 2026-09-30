import {useRef, useState} from 'react';
import {StyleSheet, Text} from 'react-native';
import {View} from 'react-native-macos';
import {moveHandle, type StreamingMovement} from './chatMovement';
import {setStreamingMovement, useStreamingMovement} from './chatPreferences';
import {useThemeStyles} from './Theme';
import type {Palette} from './themePalette';

export function StreamingMovementControl() {
  const s = useThemeStyles(makeStyles);
  const value = useStreamingMovement();
  const [width, setWidth] = useState(0);
  const [focused, setFocused] = useState<keyof StreamingMovement | null>(null);
  const drag = useRef<{x: number; value: StreamingMovement} | null>(null);
  const travel = Math.max(0, width - 16);
  const adjust = (handle: keyof StreamingMovement, amount: number) => setStreamingMovement(moveHandle(value, handle, value[handle] + amount));
  return <View style={s.frame}>
    <View style={s.labels}><Text style={s.label}>Top</Text><Text style={s.label}>Message box</Text></View>
    <View style={s.trackArea} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <View style={s.track} />
      <View style={[s.activeTrack, {left: 8 + travel * value.settle / 100, width: travel * (value.trigger - value.settle) / 100}]} />
      {(['settle', 'trigger'] as const).map(handle => <View key={handle} style={[s.thumb, {left: travel * value[handle] / 100}, focused === handle && s.focused]}
        focusable accessibilityRole="adjustable" accessibilityLabel={handle === 'settle' ? 'Settle position' : 'Trigger position'}
        accessibilityValue={{min: handle === 'settle' ? 25 : Math.max(35, value.settle + 10),
          max: handle === 'trigger' ? 100 : Math.min(90, value.trigger - 10), now: value[handle], text: `${value[handle]}% from the top`}}
        accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]}
        onAccessibilityAction={event => adjust(handle, event.nativeEvent.actionName === 'increment' ? 5 : -5)}
        onFocus={() => setFocused(handle)} onBlur={() => setFocused(null)}
        keyDownEvents={[{key: 'ArrowLeft'}, {key: 'ArrowRight'}, {key: 'Home'}, {key: 'End'}]}
        onKeyDown={event => {
          const key = event.nativeEvent.key;
          if (key === 'ArrowLeft' || key === 'ArrowRight') {event.stopPropagation(); adjust(handle, key === 'ArrowLeft' ? -5 : 5);}
          else if (key === 'Home' || key === 'End') {event.stopPropagation(); setStreamingMovement(moveHandle(value, handle, key === 'Home' ? 0 : 100));}
        }}
        onStartShouldSetResponder={() => true}
        onResponderGrant={event => {drag.current = {x: event.nativeEvent.pageX, value};}}
        onResponderMove={event => {
          if (drag.current && travel) setStreamingMovement(moveHandle(drag.current.value, handle,
            drag.current.value[handle] + (event.nativeEvent.pageX - drag.current.x) / travel * 100));
        }}
        onResponderRelease={() => {drag.current = null;}}
        onResponderTerminate={() => {drag.current = null;}} />)}
    </View>
    <View style={s.labels}><Text style={s.label}>Settle <Text style={s.value}>{value.settle}%</Text></Text>
      <Text style={s.label}>Trigger <Text style={s.value}>{value.trigger}%</Text></Text></View>
  </View>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  frame: {borderWidth: 1, borderColor: palette.border, borderRadius: 4, backgroundColor: palette.elevated, padding: 12, gap: 8},
  labels: {flexDirection: 'row', justifyContent: 'space-between', gap: 8},
  label: {fontFamily: 'Geist Native Text', color: palette.muted, fontSize: 12, lineHeight: 16},
  value: {fontFamily: 'Geist Medium', color: palette.text}, trackArea: {height: 24},
  track: {position: 'absolute', left: 8, right: 8, top: 10, height: 4, borderRadius: 2, backgroundColor: palette.surface},
  activeTrack: {position: 'absolute', top: 10, height: 4, backgroundColor: palette.accent},
  thumb: {position: 'absolute', top: 4, width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: palette.border, backgroundColor: palette.accent},
  focused: {borderColor: palette.text},
});
