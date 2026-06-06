// react-native-gesture-handler must be the very first import (before anything
// that touches the renderer) — required by @react-navigation/stack.
import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
