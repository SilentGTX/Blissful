import { Text, View } from 'react-native';
import { font } from '../theme/colors';

// Stremio brand mark for the Linked Accounts panel. The web app imports a
// dedicated StremioLogo SVG; there's no SVG asset wired into the RN app, so we
// render a self-contained rounded monogram in Stremio's purple — the same
// approach the Trakt panel uses for its mark. Sized to match the desktop
// StremioLogo size={32}.
export function StremioLogo({ size = 32 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        backgroundColor: '#7b5bf5',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: font.serif, fontSize: size * 0.6, color: '#ffffff' }}>S</Text>
    </View>
  );
}
