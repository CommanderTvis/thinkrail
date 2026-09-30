import type {TextInputMacOSProps} from 'react-native-macos';

declare module 'react-native-macos' {
  interface TextInputProps extends TextInputMacOSProps {}
}
