import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
import type { RootStackParamList } from './src/navigation/types';
import { colors } from './src/theme/colors';

const Stack = createStackNavigator<RootStackParamList>();

// JS navigator stack (NOT native-stack) + no react-native-screens — the
// focus-safe path on react-native-tvos New Arch (plan D19): native-stack's
// screen detach loses the TV focus reference (tvos #852).
const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg },
};

export default function App() {
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ToastProvider>
            <NavigationContainer theme={navTheme}>
              <Stack.Navigator
                screenOptions={{
                  headerShown: false,
                  animation: 'none',
                  cardStyle: { backgroundColor: colors.bg },
                }}
              >
                <Stack.Screen name="Home" component={HomeScreen} />
                <Stack.Screen name="Detail" component={DetailScreen} />
                <Stack.Screen name="Player" component={PlayerScreen} />
                <Stack.Screen name="Login" component={LoginScreen} />
                <Stack.Screen name="Search" component={SearchScreen} />
                <Stack.Screen name="Discover" component={DiscoverScreen} />
              </Stack.Navigator>
            </NavigationContainer>
          </ToastProvider>
        </AuthProvider>
        <StatusBar style="light" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
