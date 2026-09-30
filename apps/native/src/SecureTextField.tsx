import {requireNativeComponent, type NativeSyntheticEvent, type StyleProp, type ViewStyle} from 'react-native';

type TextEvent = NativeSyntheticEvent<{text: string}>;

const NativeSecureTextField = requireNativeComponent<{
  value: string; placeholder?: string; textColor?: string; fontSize?: number; autoFocus?: boolean;
  onTextChange: (event: TextEvent) => void; onSubmit: (event: TextEvent) => void;
  style?: StyleProp<ViewStyle>; testID?: string; accessibilityLabel?: string;
}>('ThinkRailSecureTextField');

export function SecureTextField({value, onChangeText, onSubmitEditing, placeholder, textColor, fontSize, autoFocus, style, testID, accessibilityLabel}: {
  value: string; onChangeText: (text: string) => void; onSubmitEditing?: () => void; placeholder?: string;
  textColor?: string; fontSize?: number; autoFocus?: boolean; style?: StyleProp<ViewStyle>; testID?: string; accessibilityLabel?: string;
}) {
  return <NativeSecureTextField value={value} placeholder={placeholder} textColor={textColor} fontSize={fontSize} autoFocus={autoFocus}
    onTextChange={event => onChangeText(event.nativeEvent.text)} onSubmit={() => onSubmitEditing?.()}
    style={style} testID={testID} accessibilityLabel={accessibilityLabel} />;
}
