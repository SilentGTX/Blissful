import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

// Phase-0 focus sanity check: a row of D-pad-focusable cards driven by the
// native TV focus engine (Pressable onFocus/onBlur + hasTVPreferredFocus).
// This is the load-bearing thing the whole RN-over-WebView bet rests on — if
// focus + the lavender ring move smoothly with the remote, the approach holds.
const BRAND = '#19f7d2';
const ACCENT = '#95a2ff';

function FocusCard({ label, autoFocus }: { label: string; autoFocus?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => {}}
      style={[styles.card, focused && styles.cardFocused]}
    >
      <Text style={[styles.cardText, focused && styles.cardTextFocused]}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  return (
    <View style={styles.root}>
      <Text style={styles.brand}>Blissful</Text>
      <Text style={styles.subtitle}>React Native · Android TV · Phase 0</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rail} contentContainerStyle={styles.railInner}>
        {Array.from({ length: 12 }, (_, i) => (
          <FocusCard key={i} label={`Card ${i + 1}`} autoFocus={i === 0} />
        ))}
      </ScrollView>
      <Text style={styles.hint}>Use the D-pad — focus + ring should move smoothly.</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#07090d', paddingTop: 48, paddingHorizontal: 48 },
  brand: { color: '#fff', fontSize: 44, fontWeight: '700' },
  subtitle: { color: BRAND, fontSize: 16, marginTop: 4, marginBottom: 40 },
  rail: { flexGrow: 0 },
  railInner: { gap: 20, paddingVertical: 12 },
  card: {
    width: 220,
    height: 124,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardFocused: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(149,162,255,0.18)',
    transform: [{ scale: 1.06 }],
  },
  cardText: { color: 'rgba(255,255,255,0.7)', fontSize: 18, fontWeight: '600' },
  cardTextFocused: { color: '#fff' },
  hint: { color: 'rgba(255,255,255,0.45)', fontSize: 14, marginTop: 40 },
});
