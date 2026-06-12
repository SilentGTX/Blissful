// Customize Home — show / hide / reorder the home rows. Ported from the web's
// layout/app-shell/components/HomeSettingsModal.tsx: a list of rows, each with
// Up / Down / Show-Hide controls, editing a local draft that's committed on Save.
// Reorder = swap-with-neighbour (the web's moveRow), so it maps cleanly to a D-pad.
// Wrapped in a FocusTrap so the remote can't escape behind the overlay.
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { FocusTrap } from '../FocusTrap';
import { Button } from '../ui/Button';
import { saveHomeRowPrefs } from '../../lib/addons';
import { resolveHomeRowOrder, type HomeRowOption, type HomeRowPrefs } from '../../lib/homeRows';

type M = ReturnType<typeof useMetrics>;

export function CustomizeHomeModal({
  visible,
  options,
  prefs,
  token,
  onSave,
  onClose,
}: {
  visible: boolean;
  options: HomeRowOption[];
  prefs: HomeRowPrefs;
  token: string | null;
  onSave: (prefs: HomeRowPrefs) => void;
  onClose: () => void;
}) {
  const m = useMetrics();
  const [draft, setDraft] = useState<HomeRowPrefs>({ order: [], hidden: [] });
  const scrollRef = useRef<ScrollView>(null);

  // Reseed the draft from the resolved order each time the modal OPENS — the RN
  // analogue of the web modal's key={settingsKey} remount. Only on the rising edge
  // so a late addon-manifest resolve doesn't wipe an in-progress edit.
  useEffect(() => {
    if (visible) setDraft(resolveHomeRowOrder(options, prefs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Back closes the overlay.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible) return null;

  const toggleRow = (id: string) =>
    setDraft((prev) => ({
      ...prev,
      hidden: prev.hidden.includes(id) ? prev.hidden.filter((x) => x !== id) : [...prev.hidden, id],
    }));

  const moveRow = (id: string, dir: 'up' | 'down') =>
    setDraft((prev) => {
      const idx = prev.order.indexOf(id);
      if (idx < 0) return prev;
      const swap = dir === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= prev.order.length) return prev;
      const next = [...prev.order];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return { ...prev, order: next };
    });

  const save = async () => {
    // saveHomeRowPrefs writes the local kv cache first (so guests persist too) and
    // syncs to /state when signed in — swallow a server failure, the cache holds.
    try {
      await saveHomeRowPrefs(token, draft);
    } catch {
      /* local cache already written */
    }
    onSave(draft);
    onClose();
  };

  const titleFor = (id: string) => options.find((o) => o.id === id)?.title ?? id;
  const rowPitch = m.s(72); // row height + gap, for focus-scroll
  const visibleRows = draft.order.filter((id) => options.some((o) => o.id === id));

  return (
    <View style={styles.overlay}>
      <FocusTrap
        style={{
          width: m.s(580),
          maxHeight: m.s(580),
          borderRadius: m.s(24),
          borderWidth: 1,
          borderColor: colors.hairline,
          backgroundColor: 'rgba(16,17,22,0.98)',
          padding: m.s(24),
          gap: m.s(14),
        }}
      >
        <Text style={{ fontFamily: font.serif, fontSize: m.s(30), color: '#fff' }}>Customize Home</Text>
        <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: colors.textFaint, marginTop: -m.s(8) }}>
          Show, hide, and reorder your home rows.
        </Text>

        <ScrollView
          ref={scrollRef}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: m.s(10), paddingVertical: m.s(4) }}
          showsVerticalScrollIndicator={false}
        >
          {visibleRows.map((id, index) => (
            <RowItem
              key={id}
              m={m}
              title={titleFor(id)}
              hidden={draft.hidden.includes(id)}
              autoFocus={index === 0}
              onFocus={() => scrollRef.current?.scrollTo({ y: Math.max(0, index - 1) * rowPitch, animated: true })}
              onUp={() => moveRow(id, 'up')}
              onDown={() => moveRow(id, 'down')}
              onToggle={() => toggleRow(id)}
            />
          ))}
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: m.s(12), marginTop: m.s(2) }}>
          <Button variant="solid" label="Save" onPress={save} style={{ flex: 1 }} />
          <Button variant="glass" label="Cancel" onPress={onClose} style={{ flex: 1 }} />
        </View>
      </FocusTrap>
    </View>
  );
}

function RowItem({
  m,
  title,
  hidden,
  autoFocus,
  onFocus,
  onUp,
  onDown,
  onToggle,
}: {
  m: M;
  title: string;
  hidden: boolean;
  autoFocus?: boolean;
  onFocus: () => void;
  onUp: () => void;
  onDown: () => void;
  onToggle: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: m.s(10),
        borderRadius: m.s(16),
        borderWidth: 1,
        borderColor: colors.hairline,
        backgroundColor: colors.surface,
        paddingHorizontal: m.s(14),
        paddingVertical: m.s(10),
        opacity: hidden ? 0.5 : 1,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.bodySemi, fontSize: m.s(18), color: '#fff' }}>
          {title}
        </Text>
        <Text style={{ fontFamily: font.body, fontSize: m.s(13), color: colors.textGhost }}>
          {hidden ? 'Hidden' : 'Visible'}
        </Text>
      </View>
      <MiniBtn m={m} label="Up" autoFocus={autoFocus} onFocus={onFocus} onPress={onUp} />
      <MiniBtn m={m} label="Down" onFocus={onFocus} onPress={onDown} />
      <MiniBtn m={m} label={hidden ? 'Show' : 'Hide'} wide onFocus={onFocus} onPress={onToggle} />
    </View>
  );
}

function MiniBtn({
  m,
  label,
  wide,
  autoFocus,
  onFocus,
  onPress,
}: {
  m: M;
  label: string;
  wide?: boolean;
  autoFocus?: boolean;
  onFocus: () => void;
  onPress: () => void;
}) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => {
        setF(true);
        onFocus();
      }}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{
        minWidth: wide ? m.s(66) : m.s(54),
        alignItems: 'center',
        paddingVertical: m.s(9),
        paddingHorizontal: m.s(12),
        borderRadius: 999,
        backgroundColor: f ? colors.accent : 'rgba(255,255,255,0.08)',
        borderWidth: m.s(2),
        borderColor: f ? colors.accent : 'transparent',
      }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(15), color: f ? colors.accentInk : 'rgba(255,255,255,0.85)' }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 260,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
});
