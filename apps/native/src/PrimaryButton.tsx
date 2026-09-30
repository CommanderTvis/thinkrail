import {useState} from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import {Icon, type IconName} from './Icon';
import {SpinningIcon} from './SpinningIcon';
import {color, useThemeStyles} from './Theme';
import type {Palette} from './themePalette';

export function PrimaryButton({label, onPress, disabled = false, icon, iconSize = 14, small = false, spinning = false, accessibilityRole = 'button', testID}: {
  testID?: string; accessible?: boolean; label: string; onPress: () => void; disabled?: boolean; icon?: IconName; iconSize?: number; small?: boolean; spinning?: boolean; accessibilityRole?: 'button' | 'link';
}) {
  const s = useThemeStyles(makeStyles);
  const [hovered, setHovered] = useState(false);
  return <Pressable testID={testID} accessibilityRole={accessibilityRole} accessibilityState={{disabled}} onPress={onPress} disabled={disabled}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[s.button, small && s.small, hovered && s.hovered, disabled && s.disabled]}>
    {icon ? spinning ? <SpinningIcon name={icon} size={iconSize} color={disabled ? color.primaryDisabledText : color.onAccent} />
      : <Icon name={icon} size={iconSize} color={disabled ? color.primaryDisabledText : color.onAccent} /> : null}
    <Text style={[s.label, disabled && s.disabledLabel]}>{label}</Text>
  </Pressable>;
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  button: {height: 32, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 4, backgroundColor: palette.accentSolid},
  small: {height: 28, paddingHorizontal: 8}, hovered: {backgroundColor: palette.accentHover}, disabled: {backgroundColor: palette.primaryDisabledBg},
  label: {fontFamily: 'Geist Native Text', fontSize: 14, lineHeight: 20, color: palette.onAccent},
  disabledLabel: {color: palette.primaryDisabledText},
});
