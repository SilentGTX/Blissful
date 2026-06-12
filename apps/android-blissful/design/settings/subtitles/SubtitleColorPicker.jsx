/**
 * SubtitleColorPicker (React Native)
 * ----------------------------------
 * Compact subtitle color picker — one palette switched between
 * Text / Background / Outline, with a live caption preview.
 *
 * Dependency: react-native-svg  (npm i react-native-svg)
 *
 * Usage (controlled):
 *   const [colors, setColors] = useState({ text: '#ffffff', bg: 'none', outline: '#0b0b0d' });
 *   <SubtitleColorPicker value={colors} onChange={setColors} />
 *
 * Usage (uncontrolled): just <SubtitleColorPicker /> — manages its own state.
 *
 * `bg` and `outline` may be the string 'none'. `text` is always a hex.
 */

import React, { useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated, LayoutAnimation,
  Platform, UIManager,
} from 'react-native';
import Svg, { Path, Circle, Line } from 'react-native-svg';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ----------------------------- tokens ----------------------------- */
export const ACCENT = '#8aa0ff';

export const SWATCHES = [
  { name: 'Periwinkle', hex: '#8aa0ff' },
  { name: 'Teal',       hex: '#1ad1b0' },
  { name: 'White',      hex: '#ffffff' },
  { name: 'Black',      hex: '#0b0b0d' },
  { name: 'Yellow',     hex: '#f5c518' },
  { name: 'Red',        hex: '#f5402c' },
  { name: 'Green',      hex: '#22b14c' },
  { name: 'Blue',       hex: '#1577f2' },
  { name: 'Violet',     hex: '#c061f0' },
  { name: 'Orange',     hex: '#f59e0b' },
];

const CHANNELS = [
  { key: 'text',    label: 'Text' },
  { key: 'bg',      label: 'Background' },
  { key: 'outline', label: 'Outline' },
];

/* --------------------------- color utils -------------------------- */
function isLight(hex) {
  const h = hex.replace('#', '');
  const f = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(f(0)) + 0.7152 * lin(f(2)) + 0.0722 * lin(f(4));
  return L > 0.5;
}
function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const f = (i) => parseInt(h.slice(i, i + 2), 16);
  return `rgba(${f(0)},${f(2)},${f(4)},${a})`;
}

/* ------------------------------ icons ----------------------------- */
const CheckIcon = ({ color }) => (
  <Svg width={14} height={14} viewBox="0 0 24 24">
    <Path d="M5 13l4 4L19 7" fill="none" stroke={color} strokeWidth={3.5}
          strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const Chevron = () => (
  <Svg width={18} height={18} viewBox="0 0 24 24">
    <Path d="M6 9l6 6 6-6" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={2.4}
          strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const NoneGlyph = () => (
  <Svg width={30} height={30} viewBox="0 0 30 30" style={StyleSheet.absoluteFill}>
    <Circle cx={15} cy={15} r={13.5} fill="none" stroke="rgba(255,255,255,0.22)"
            strokeWidth={1} strokeDasharray="3 3" />
    <Line x1={7} y1={23} x2={23} y2={7} stroke="#f5402c" strokeWidth={2} strokeLinecap="round" />
  </Svg>
);

/* ------------------------------ swatch ---------------------------- */
function Swatch({ hex, name, selected, isNone, onPress }) {
  const light = hex ? isLight(hex) : false;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={isNone ? 'None' : name}
      accessibilityState={{ selected }}
      style={[s.ring, selected && s.ringActive]}
    >
      <View style={[s.dot, { backgroundColor: isNone ? 'transparent' : hex }]}>
        {isNone && <NoneGlyph />}
        {selected && !isNone && <CheckIcon color={light ? '#0b0b0d' : '#ffffff'} />}
      </View>
    </Pressable>
  );
}

/* ----------------------------- palette ---------------------------- */
function Palette({ value, onChange, allowNone }) {
  return (
    <View style={s.palette}>
      {allowNone && (
        <Swatch isNone selected={value === 'none'} onPress={() => onChange('none')} />
      )}
      {SWATCHES.map((c) => (
        <Swatch key={c.hex} hex={c.hex} name={c.name}
                selected={value === c.hex} onPress={() => onChange(c.hex)} />
      ))}
    </View>
  );
}

/* --------------------- outlined caption preview ------------------- */
function Caption({ text, bg, outline }) {
  const showBg = bg !== 'none';
  const showOutline = outline !== 'none';
  const offsets = [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]];
  const base = {
    fontSize: 17, lineHeight: 22, fontWeight: '700', textAlign: 'center', letterSpacing: 0.2,
  };
  const LABEL = 'Subtitles look like this';
  return (
    <View style={[s.captionWrap, showBg && { backgroundColor: hexToRgba(bg, 0.85) }]}>
      <View>
        {/* outline layer: offset copies behind the fill */}
        {showOutline &&
          offsets.map(([x, y], i) => (
            <Text key={i} style={[base, s.captionAbs, { color: outline, transform: [{ translateX: x }, { translateY: y }] }]}>
              {LABEL}
            </Text>
          ))}
        <Text style={[base, { color: text, textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 }]}>
          {LABEL}
        </Text>
      </View>
    </View>
  );
}

function Preview({ text, bg, outline }) {
  return (
    <View style={s.preview}>
      <Text style={s.previewTag}>PREVIEW</Text>
      <View style={s.previewBody}>
        <Caption text={text} bg={bg} outline={outline} />
      </View>
      <View style={s.scrubber}>
        <View style={s.scrubberFill} />
      </View>
    </View>
  );
}

/* -------------------------- segmented control --------------------- */
function Segmented({ active, onChange, vals }) {
  const [w, setW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const idx = CHANNELS.findIndex((c) => c.key === active);
  const seg = w > 0 ? (w - 8) / 3 : 0;

  const move = (i) => {
    Animated.timing(x, { toValue: i * seg, duration: 220, useNativeDriver: true }).start();
  };

  return (
    <View style={s.segment} onLayout={(e) => { const ww = e.nativeEvent.layout.width; setW(ww); x.setValue(idx * ((ww - 8) / 3)); }}>
      {seg > 0 && (
        <Animated.View style={[s.segPill, { width: seg, transform: [{ translateX: x }] }]} />
      )}
      {CHANNELS.map((c, i) => {
        const on = active === c.key;
        const v = vals[c.key];
        return (
          <Pressable key={c.key} style={s.segBtn}
            onPress={() => { onChange(c.key); move(i); }}>
            <View style={[s.segDot, v === 'none'
              ? { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' }
              : { backgroundColor: v }]} />
            <Text style={[s.segLabel, { color: on ? '#fff' : 'rgba(255,255,255,0.5)' }]}>{c.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ----------------------------- dropdown --------------------------- */
function Dropdown({ glyph, value }) {
  return (
    <Pressable style={s.dropdown}>
      <Text style={s.dropdownGlyph}>{glyph}</Text>
      <Text style={s.dropdownValue}>{value}</Text>
      <Chevron />
    </Pressable>
  );
}

/* ------------------------------- main ----------------------------- */
export default function SubtitleColorPicker({ value, onChange }) {
  const [internal, setInternal] = useState({ text: '#ffffff', bg: 'none', outline: '#0b0b0d' });
  const vals = value || internal;
  const set = (k, v) => {
    const next = { ...vals, [k]: v };
    if (onChange) onChange(next);
    if (!value) setInternal(next);
  };
  const [active, setActive] = useState('text');

  return (
    <View style={s.card}>
      <Text style={s.title}>Subtitles</Text>

      <Text style={s.label}>Language</Text>
      <Dropdown glyph="文A" value="English" />

      <View style={{ height: 18 }} />
      <Text style={s.label}>Size</Text>
      <Dropdown glyph="Aa" value="28px" />

      <View style={{ height: 26 }} />
      <Preview text={vals.text} bg={vals.bg} outline={vals.outline} />

      <Text style={s.label}>Color</Text>
      <Segmented active={active} onChange={setActive} vals={vals} />
      <Palette value={vals[active]} onChange={(v) => set(active, v)} allowNone={active !== 'text'} />
    </View>
  );
}

/* ----------------------------- styles ----------------------------- */
const s = StyleSheet.create({
  card: {
    width: 440, padding: 26, borderRadius: 26, backgroundColor: '#13171f',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 22 },
  label: { color: 'rgba(255,255,255,0.52)', fontSize: 13.5, fontWeight: '500', marginBottom: 11 },

  dropdown: {
    flexDirection: 'row', alignItems: 'center', height: 54, paddingHorizontal: 18,
    borderRadius: 14, backgroundColor: '#212736',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  dropdownGlyph: { color: 'rgba(255,255,255,0.45)', fontSize: 15, marginRight: 12, fontWeight: '600' },
  dropdownValue: { color: '#fff', fontSize: 15.5, fontWeight: '700', flex: 1 },

  /* preview */
  preview: {
    height: 132, borderRadius: 16, marginBottom: 22, overflow: 'hidden',
    backgroundColor: '#161b2b', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'flex-end',
  },
  previewTag: {
    position: 'absolute', top: 11, left: 14, color: 'rgba(255,255,255,0.4)',
    fontSize: 10.5, letterSpacing: 0.5, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  previewBody: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 26 },
  captionWrap: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 7, maxWidth: '82%' },
  captionAbs: { position: 'absolute', left: 0, right: 0 },
  scrubber: {
    position: 'absolute', left: 14, right: 14, bottom: 12, height: 3, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  scrubberFill: { width: '34%', height: '100%', borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.7)' },

  /* segmented */
  segment: {
    flexDirection: 'row', padding: 4, borderRadius: 12, marginBottom: 18,
    backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  segPill: {
    position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 9,
    backgroundColor: '#2a3144', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  segBtn: { flex: 1, height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  segDot: { width: 12, height: 12, borderRadius: 6 },
  segLabel: { fontSize: 13.5, fontWeight: '600' },

  /* palette + swatch */
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  ring: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  ringActive: { borderColor: ACCENT },
  dot: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
});
