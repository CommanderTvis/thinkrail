/**
 * @format
 */

import './src/automation';
import { startAutomation } from './src/automation';
import { AppRegistry, NativeModules } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';
import {ThemeProvider} from './src/Theme';
import {ImagePreviewProvider} from './src/ToolResultImages';

if (NativeModules.NativeOniguruma?.probe) {
  import('./src/nativeSyntaxHighlighter').then(module => module.probeNativeHighlighting())
    .then(results => NativeModules.NativeOniguruma.reportProbe({results}))
    .catch(error => NativeModules.NativeOniguruma.reportProbe({error: String(error)}));
}

AppRegistry.registerComponent(appName, () => props => {
  if (props.automationURL) startAutomation(props.automationURL);
  return <ThemeProvider><ImagePreviewProvider><App {...props} /></ImagePreviewProvider></ThemeProvider>;
});
