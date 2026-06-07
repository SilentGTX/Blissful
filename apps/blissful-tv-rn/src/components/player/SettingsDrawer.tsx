import { useEffect, useRef } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';

const ACCENT = '#95a2ff';

export type DrawerItem = { id: string; label: string; meta?: string | null; active: boolean };

// 1:1 of the old NativeMpvPlayer/SettingsPanel: a panel that SLIDES IN FROM THE
// RIGHT (spring), Audio / Subtitles tabs, lavender-active rows, glass #101116
// body. The D-pad is driven by the player (single focus owner): Up/Down move
// `selIdx`, Left/Back close (slides back out right), OK applies the lit row.
export function SettingsDrawer({
  open,
  tab,
  items,
  selIdx,
}: {
  open: boolean;
  tab: 'audio' | 'subtitles';
  items: DrawerItem[];
  selIdx: number;
}) {
  const m = useMetrics();
  const W = m.s(420);
  const offX = W + m.s(32);
  const tx = useRef(new Animated.Value(offX)).current;
  const op = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(tx, { toValue: open ? 0 : offX, stiffness: 280, damping: 32, mass: 0.85, useNativeDriver: true }).start();
    Animated.timing(op, { toValue: open ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [open, offX, tx, op]);

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity: op, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'flex-end', paddingTop: m.s(112), paddingBottom: m.s(112), paddingHorizontal: m.s(32) }]}
      pointerEvents="none"
    >
      <Animated.View style={{ transform: [{ translateX: tx }], width: W, maxHeight: '100%', gap: m.s(12) }}>
        {/* Tabs + close row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: m.s(8) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(4), borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)', padding: m.s(4) }}>
            <Tab m={m} label="Audio" active={tab === 'audio'} />
            <Tab m={m} label="Subtitles" active={tab === 'subtitles'} />
          </View>
          <View style={{ width: m.s(36), height: m.s(36), borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={m.s(18)} color="#fff" />
          </View>
        </View>

        {/* Content panel */}
        <View style={{ flexShrink: 1, overflow: 'hidden', borderRadius: m.s(28), borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(16,17,22,0.97)' }}>
          <ScrollView contentContainerStyle={{ padding: m.s(12), gap: m.s(4) }} showsVerticalScrollIndicator={false}>
            {items.length === 0 ? (
              <View style={{ borderRadius: m.s(12), backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: m.s(16), paddingVertical: m.s(12) }}>
                <Text style={{ fontFamily: font.body, fontSize: m.s(18), color: 'rgba(255,255,255,0.6)' }}>
                  {tab === 'audio' ? 'No audio tracks' : 'No subtitles available'}
                </Text>
              </View>
            ) : (
              items.map((it, i) => {
                const focused = i === selIdx;
                const active = it.active;
                return (
                  <View
                    key={it.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: m.s(12),
                      borderRadius: m.s(12),
                      paddingHorizontal: m.s(16),
                      paddingVertical: m.s(12),
                      borderWidth: focused ? m.s(2) : 0,
                      borderColor: focused ? ACCENT : 'transparent',
                      backgroundColor: active ? 'rgba(149,162,255,0.15)' : focused ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                    }}
                  >
                    <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.body, fontSize: m.s(19), color: active ? ACCENT : 'rgba(255,255,255,0.9)' }}>
                      {it.label}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
                      {it.meta ? (
                        <View style={{ borderRadius: m.s(4), backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: m.s(8), paddingVertical: m.s(2) }}>
                          <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(11), letterSpacing: m.s(0.5), color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' }}>{it.meta}</Text>
                        </View>
                      ) : null}
                      {active ? <Ionicons name="checkmark" size={m.s(20)} color={ACCENT} /> : null}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function Tab({ m, label, active }: { m: ReturnType<typeof useMetrics>; label: string; active: boolean }) {
  return (
    <View style={{ borderRadius: 999, paddingHorizontal: m.s(16), paddingVertical: m.s(6), backgroundColor: active ? 'rgba(255,255,255,0.15)' : 'transparent' }}>
      <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(14), color: active ? '#fff' : 'rgba(255,255,255,0.6)' }}>{label}</Text>
    </View>
  );
}
