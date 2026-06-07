import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useEffect, useRef, useState } from 'react';
import { BackHandler, findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { FocusTrap } from './FocusTrap';
import { Img } from './Img';
import type { CwItem } from '../lib/continueWatching';

function fmtTime(total: number): string {
  total = Math.max(0, Math.floor(total));
  const h = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

// Port of ResumeOrStartOverModal (TV variant). Rendered as an absolute overlay
// (not a Modal) so D-pad select fires reliably; the 3 buttons trap focus.
export function ResumeModal({
  item,
  onResume,
  onStartOver,
  onGoToDetail,
  onClose,
}: {
  item: CwItem | null;
  onResume: (i: CwItem) => void;
  onStartOver: (i: CwItem) => void;
  onGoToDetail: (i: CwItem) => void;
  onClose: () => void;
}) {
  const m = useMetrics();
  const r0 = useRef<View>(null);
  const r1 = useRef<View>(null);
  const r2 = useRef<View>(null);
  const refs = [r0, r1, r2];
  const [tags, setTags] = useState<(number | undefined)[]>([]);

  useEffect(() => {
    if (!item) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    const id = setTimeout(() => setTags(refs.map((r) => (r.current ? findNodeHandle(r.current) ?? undefined : undefined))), 220);
    return () => {
      sub.remove();
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, onClose]);

  if (!item) return null;

  const cardW = m.s(440);
  const buttons = [
    { label: `Resume ${fmtTime(item.resumeSeconds)}`, primary: true, run: () => onResume(item) },
    { label: 'Start from beginning', run: () => onStartOver(item) },
    { label: 'Go to show', run: () => onGoToDetail(item) },
  ];

  return (
    <View style={styles.overlay}>
      <FocusTrap style={{ width: cardW, borderRadius: m.s(20), overflow: 'hidden', backgroundColor: '#101116', borderWidth: 1, borderColor: colors.hairline }}>
        {item.poster ? (
          <>
            <Img uri={item.poster} style={StyleSheet.absoluteFill} contentFit="cover" />
            <LinearGradient colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0.75)', '#101116']} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
          </>
        ) : null}

        <Pressable onPress={onClose} style={{ position: 'absolute', right: m.s(12), top: m.s(12), zIndex: 2, width: m.s(40), height: m.s(40), borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={m.s(22)} color="rgba(255,255,255,0.9)" />
        </Pressable>

        <View style={{ height: m.s(120) }} />

        <View style={{ paddingHorizontal: m.s(20), paddingBottom: m.s(20) }}>
          <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(16), letterSpacing: m.s(2), textTransform: 'uppercase', color: colors.accent }}>Continue watching</Text>
          <Text numberOfLines={2} style={{ fontFamily: font.bodySemi, fontSize: m.s(34), color: '#fff', marginTop: m.s(4) }}>{item.name}</Text>
          {item.episodeLabel ? <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(22), color: 'rgba(255,255,255,0.75)', marginTop: m.s(4) }}>{item.episodeLabel}</Text> : null}

          <View style={{ gap: m.s(10), marginTop: m.s(18) }}>
            {buttons.map((b, i) => (
              <ModalButton
                key={i}
                ref={refs[i]}
                label={b.label}
                primary={b.primary}
                autoFocus={i === 0}
                nextUp={tags[i - 1] ?? tags[i]}
                nextDown={tags[i + 1] ?? tags[i]}
                self={tags[i]}
                m={m}
                onPress={() => {
                  b.run();
                  onClose();
                }}
              />
            ))}
          </View>
        </View>
      </FocusTrap>
    </View>
  );
}

const ModalButton = forwardRef<View, { label: string; primary?: boolean; autoFocus?: boolean; nextUp?: number; nextDown?: number; self?: number; m: ReturnType<typeof useMetrics>; onPress: () => void }>(
  ({ label, primary, autoFocus, nextUp, nextDown, self, m, onPress }, ref) => {
    const [f, setF] = useState(false);
    const fg = primary ? colors.accent : 'rgba(255,255,255,0.85)';
    return (
      <Pressable
        ref={ref}
        hasTVPreferredFocus={autoFocus}
        nextFocusUp={nextUp}
        nextFocusDown={nextDown}
        nextFocusLeft={self}
        nextFocusRight={self}
        onFocus={() => setF(true)}
        onBlur={() => setF(false)}
        onPress={onPress}
        style={{
          paddingVertical: m.s(15),
          alignItems: 'center',
          borderRadius: m.s(16),
          backgroundColor: primary ? 'rgba(149,162,255,0.25)' : 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          borderColor: f ? colors.accent : primary ? 'rgba(149,162,255,0.4)' : 'rgba(255,255,255,0.1)',
        }}
      >
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(24), color: fg }}>{label}</Text>
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.75)' },
});
