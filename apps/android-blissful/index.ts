// react-native-gesture-handler must be the very first import (before anything
// that touches the renderer) — required by @react-navigation/stack.
import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import { LogBox } from 'react-native';
import { registerRootComponent } from 'expo';

import App from './App';

// Silence expo-video's iOS-only `VideoPlayer.replace` deprecation warning — it
// doesn't apply to our Android TV target (we switch streams via replace on every
// release change) and it was popping the LogBox "Open debugger to view warnings"
// toast over the player. Targeted so every other warning still surfaces in dev.
LogBox.ignoreLogs(['`VideoPlayer.replace`']);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
