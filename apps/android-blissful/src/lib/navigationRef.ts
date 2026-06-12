import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';

// Shared navigation ref so app-root overlays (the PartyInviteListener, mounted
// OUTSIDE the navigator's screens) can navigate / set params. Attached to the
// <NavigationContainer> in App.tsx.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
