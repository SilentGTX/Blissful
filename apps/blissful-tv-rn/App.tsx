import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BootSplash } from './src/components/BootSplash';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import {
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans';
import { AuthProvider } from './src/context/AuthContext';
import { ToastProvider } from './src/components/Toast';
import { HomeScreen } from './src/screens/HomeScreen';
import { DetailScreen } from './src/screens/DetailScreen';
import { PlayerScreen } from './src/screens/PlayerScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { DiscoverScreen } from './src/screens/DiscoverScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { AddonsScreen } from './src/screens/AddonsScreen';
import type { RootStackParamList } from './src/navigation/types';
import { colors } from './src/theme/colors';

const Stack = createStackNavigator<RootStackParamList>();

// Transparent so the app-root gradient (ThemedRoot) shows through every screen.
const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: 'transparent', card: 'transparent' },
};

// The app-root surface gradient + the (transparent) navigator on top. Lives
// inside ThemeProvider so the gradient retints live when the user changes the
// Settings surface colour.
function ThemedRoot() {
  const { bgGradient } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LinearGradient colors={bgGradient as [string, string, string]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            animation: 'none',
            cardStyle: { backgroundColor: 'transparent' },
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Detail" component={DetailScreen} />
          <Stack.Screen name="Player" component={PlayerScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Search" component={SearchScreen} />
          <Stack.Screen name="Discover" component={DiscoverScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="Library" component={LibraryScreen} />
          <Stack.Screen name="Addons" component={AddonsScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
  });

  // Boot splash: shows the Blissful wordmark + loading line on launch, then fades
  // out a beat after fonts load + the app mounts (covers the initial render flash,
  // mirrors the old android / windows / web boot screen).
  const [splashDone, setSplashDone] = useState(false);
  const [splashGone, setSplashGone] = useState(false);
  useEffect(() => {
    if (!fontsLoaded) return;
    const t = setTimeout(() => setSplashDone(true), 1600);
    return () => clearTimeout(t);
  }, [fontsLoaded]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {fontsLoaded ? (
          <ThemeProvider>
            <AuthProvider>
              <ToastProvider>
                <ThemedRoot />
              </ToastProvider>
            </AuthProvider>
          </ThemeProvider>
        ) : (
          <View style={{ flex: 1, backgroundColor: colors.bg }} />
        )}
        {!splashGone ? (
          <BootSplash done={fontsLoaded && splashDone} onHidden={() => setSplashGone(true)} />
        ) : null}
        <StatusBar style="light" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
