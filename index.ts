import { registerRootComponent } from 'expo';

import App from './App';
// Registers the background location task. It has to run at startup, in the global scope, so Android can
// deliver location updates to it even when the app is closed and no screen has mounted.
import './src/features/trackTask';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
