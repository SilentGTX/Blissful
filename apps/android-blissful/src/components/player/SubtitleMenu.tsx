// Self-contained TV subtitle picker overlay. Mirrors StreamPicker's shell
// (centered glass panel, header with back/close icon buttons, a FlatList of
// D-pad-focusable rows with the lavender focus ring). It does NOT fetch — the
// player owns the data (via lib/subtitles.loadSubtitles) and passes the grouped
// languages + the current selection in as props. Selecting a language fires
// `onSelect(track)`; the "Off" row fires `onSelect(null)`.
//
// Why a language picker (not a flat variant list): every web pipeline (desktop
// SubtitleMenuPopover) groups by canonical language and auto-applies the
// best-rated variant for the chosen language. On a 10-foot D-pad UI a single
// language column is the right altitude — picking "English" applies the
// highest-rated English variant immediately (groups[].tracks[0]).

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { BackHandler, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import type { SubtitleLanguageGroup, SubtitleTrack } from '../../lib/subtitles';

type M = ReturnType<typeof useMetrics>;

export type SubtitleMenuProps = {
  /** Render gate — when false the overlay is unmounted. */
  visible: boolean;
  /** Grouped languages (from loadSubtitles().groups). Empty while loading. */
  groups: SubtitleLanguageGroup[];
  /** Currently-applied track, or null for "Off". Drives the active highlight. */
  selected: SubtitleTrack | null;
  /** True while the player is still fetching — shows a spinner-less hint row. */
  loading?: boolean;
  /** Pick a language → apply its best-rated variant. null = turn subtitles off. */
  onSelect: (track: SubtitleTrack | null) => void;
  /** Dismiss without changing the selection (Back / close / outside press). */
  onClose: () => void;
};

// A flattened FlatList row: the "Off" entry, or one language group.
type Item =
  | { kind: 'off'; key: string; autoFocus: boolean }
  | { kind: 'lang'; key: string; group: SubtitleLanguageGroup; autoFocus: boolean };

function LangRow({
  langName,
  count,
  active,
  autoFocus,
  m,
  onPress,
}: {
  langName: string;
  count: number;
  active: boolean;
  autoFocus: boolean;
  m: M;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: m.s(12),
        borderRadius: m.s(18),
        paddingHorizontal: m.s(16),
        paddingVertical: m.s(13),
        borderWidth: 1,
        borderColor: focused ? colors.accent : 'transparent',
        backgroundColor: focused ? 'rgba(255,255,255,0.10)' : 'transparent',
        transform: [{ scale: focused ? 1.01 : 1 }], // never undefined (New-Arch forEach crash)
      }}
    >
      <Text
        numberOfLines={1}
        style={{ flex: 1, fontFamily: font.bodySemi, fontSize: m.s(20), color: active ? colors.accent : colors.text }}
      >
        {langName}
      </Text>
      {count > 1 ? (
        <View style={{ borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: m.s(9), paddingVertical: m.s(1) }}>
          <Text style={{ fontFamily: font.body, fontSize: m.s(13), color: 'rgba(255,255,255,0.6)' }}>{count}</Text>
        </View>
      ) : null}
      {active ? <Ionicons name="checkmark" size={m.s(22)} color={colors.accent} /> : null}
    </Pressable>
  );
}

function OffRow({ active, autoFocus, m, onPress }: { active: boolean; autoFocus: boolean; m: M; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: m.s(12),
        borderRadius: m.s(18),
        paddingHorizontal: m.s(16),
        paddingVertical: m.s(13),
        marginBottom: m.s(4),
        borderWidth: 1,
        borderColor: focused ? colors.accent : 'transparent',
        backgroundColor: focused ? 'rgba(255,255,255,0.10)' : 'transparent',
      }}
    >
      <Text style={{ flex: 1, fontFamily: font.bodySemi, fontSize: m.s(20), color: active ? colors.accent : colors.text }}>Off</Text>
      {active ? <Ionicons name="checkmark" size={m.s(22)} color={colors.accent} /> : null}
    </Pressable>
  );
}

function IconBtn({ m, icon, onPress }: { m: M; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  const [f, setF] = useState(false);
  const sz = m.s(44);
  return (
    <Pressable
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{ width: sz, height: sz, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: f ? colors.accent : 'transparent' }}
    >
      <Ionicons name={icon} size={m.s(22)} color="rgba(255,255,255,0.85)" />
    </Pressable>
  );
}

export function SubtitleMenu({ visible, groups, selected, loading, onSelect, onClose }: SubtitleMenuProps) {
  const m = useMetrics();

  // Hardware Back closes the menu (matches StreamPicker).
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible) return null;

  const isOff = selected == null;
  // Auto-focus the active language row if one is applied, else "Off".
  const activeLangName = selected?.langName ?? null;
  let autoFocusUsed = false;
  const items: Item[] = [];
  const offActive = isOff && !loading;
  items.push({ kind: 'off', key: 'off', autoFocus: offActive });
  if (offActive) autoFocusUsed = true;
  for (const group of groups) {
    const isActiveLang = group.langName === activeLangName;
    const autoFocus = !autoFocusUsed && isActiveLang;
    if (autoFocus) autoFocusUsed = true;
    items.push({ kind: 'lang', key: group.langName, group, autoFocus });
  }
  // Nothing matched for auto-focus yet (e.g. Off is active but loading, or the
  // applied lang vanished) → focus the first row so the D-pad has an entry point.
  if (!autoFocusUsed && items.length > 0) items[0].autoFocus = true;

  const panelW = Math.min(m.s(680), m.width * 0.6);

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={{ width: panelW, maxHeight: m.height * 0.82, borderRadius: m.s(28), overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
        <LinearGradient colors={['rgba(22,27,38,0.99)', 'rgba(10,13,20,0.995)']} start={{ x: 0.85, y: 0 }} end={{ x: 0.15, y: 1 }} style={StyleSheet.absoluteFill} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(14), paddingHorizontal: m.s(22), paddingTop: m.s(20), paddingBottom: m.s(12) }}>
          <IconBtn m={m} icon="chevron-back" onPress={onClose} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ textAlign: 'center', fontFamily: font.bodySemi, fontSize: m.s(26), color: colors.text }}>Subtitles</Text>
          </View>
          <IconBtn m={m} icon="close" onPress={onClose} />
        </View>

        <View style={{ flexGrow: 1, flexShrink: 1, paddingHorizontal: m.s(18), paddingBottom: m.s(20) }}>
          {loading && groups.length === 0 ? (
            <View style={{ paddingVertical: m.s(40), alignItems: 'center' }}>
              <Text style={{ fontFamily: font.body, fontSize: m.s(18), color: 'rgba(255,255,255,0.7)' }}>Loading subtitles…</Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(it) => it.key}
              removeClippedSubviews={false}
              showsVerticalScrollIndicator={false}
              ListFooterComponent={
                !loading && groups.length === 0 ? (
                  <Text style={{ fontFamily: font.body, fontSize: m.s(16), color: 'rgba(255,255,255,0.55)', paddingHorizontal: m.s(16), paddingVertical: m.s(10) }}>
                    No subtitles found for this title.
                  </Text>
                ) : loading ? (
                  <Text style={{ fontFamily: font.body, fontSize: m.s(14), color: 'rgba(255,255,255,0.5)', paddingHorizontal: m.s(16), paddingVertical: m.s(10) }}>
                    Loading more…
                  </Text>
                ) : null
              }
              renderItem={({ item }) => {
                if (item.kind === 'off') {
                  return <OffRow active={isOff} autoFocus={item.autoFocus} m={m} onPress={() => { onSelect(null); onClose(); }} />;
                }
                const best = item.group.tracks[0];
                return (
                  <LangRow
                    langName={item.group.langName}
                    count={item.group.tracks.length}
                    active={item.group.langName === activeLangName}
                    autoFocus={item.autoFocus}
                    m={m}
                    onPress={() => { if (best) onSelect(best); onClose(); }}
                  />
                );
              }}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same z-order family as StreamPicker (250). Centered glass panel over a dim.
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 250, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(3,5,10,0.66)' },
});
