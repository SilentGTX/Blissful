import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ColorSwatchRow } from './ColorSwatchRow';
import { useTvFocusable } from '../../lib/useTvFocusable';
import { colors, font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';

// Subtitle colour picker — 1:1 with design/settings/subtitles/SubtitleColorPicker.jsx:
// a live caption PREVIEW + a segmented Text / Background / Outline control that
// switches a per-channel palette. D-pad-driven (geometry handles tab<->tab +
// tab->palette), SVG-free.
//
// The palettes are the desktop's rgba subtitle colours (so a saved account colour
// like mint text / transparent bg / black outline matches a swatch). Any custom
// colour outside the palette still renders in the live preview.

type M = ReturnType<typeof useMetrics>;
export type SubChannel = 'text' | 'bg' | 'outline';
const CHANNELS: { key: SubChannel; label: string }[] = [
  { key: 'text', label: 'Text' },
  { key: 'bg', label: 'Background' },
  { key: 'outline', label: 'Outline' },
];

// Text: the 12 desktop rgba swatches (verbatim from the player SettingsPanel).
const TEXT_SWATCHES = [
  'rgba(255,255,255,1)',
  'rgba(255,84,112,1)',
  'rgba(189,189,189,1)',
  'rgba(200,255,225,1)',
  'rgba(140,40,230,1)',
  'rgba(230,40,40,1)',
  'rgba(40,210,140,1)',
  'rgba(255,180,40,1)',
  'rgba(255,200,210,1)',
  'rgba(80,160,235,1)',
  'rgba(30,60,140,1)',
  'rgba(245,224,170,1)',
];
// Background + outline are usually transparent / dark, so each leads with a
// transparent swatch then opacity steps + white.
const BG_SWATCHES = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.85)', 'rgba(0,0,0,1)', 'rgba(255,255,255,1)'];
const OUTLINE_SWATCHES = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.75)', 'rgba(0,0,0,1)', 'rgba(255,255,255,1)'];
const SWATCHES: Record<SubChannel, string[]> = { text: TEXT_SWATCHES, bg: BG_SWATCHES, outline: OUTLINE_SWATCHES };

function SegTab({ label, dot, active, onPress, m }: { label: string; dot: string; active: boolean; onPress: () => void; m: M }) {
  const { focused, focusProps } = useTvFocusable({ onPress });
  return (
    <Pressable
      {...focusProps}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: m.s(8),
        height: m.s(46),
        borderRadius: m.s(11),
        backgroundColor: active ? '#2a3144' : 'transparent',
        borderWidth: 1,
        borderColor: focused ? colors.accent : active ? 'rgba(255,255,255,0.08)' : 'transparent',
      }}
    >
      <View style={{ width: m.s(13), height: m.s(13), borderRadius: m.s(7), backgroundColor: dot }} />
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(16), color: active ? '#fff' : 'rgba(255,255,255,0.55)' }}>{label}</Text>
    </Pressable>
  );
}

function Preview({ text, bg, outline, m }: { text: string; bg: string; outline: string; m: M }) {
  const LABEL = 'Subtitles look like this';
  const off = m.s(1.8);
  const offsets = [[-off, -off], [off, -off], [-off, off], [off, off]];
  return (
    <View style={{ height: m.s(132), borderRadius: m.s(16), marginBottom: m.s(18), overflow: 'hidden', backgroundColor: '#161b2b', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', justifyContent: 'flex-end' }}>
      <Text style={{ position: 'absolute', top: m.s(11), left: m.s(14), color: 'rgba(255,255,255,0.4)', fontSize: m.s(12), fontFamily: font.body, letterSpacing: 0.5 }}>PREVIEW</Text>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: m.s(26) }}>
        <View style={[{ paddingHorizontal: m.s(12), paddingVertical: m.s(5), borderRadius: m.s(7) }, bg ? { backgroundColor: bg } : null]}>
          <View>
            {outline
              ? offsets.map(([x, y], i) => (
                  <Text key={i} style={{ position: 'absolute', left: 0, right: 0, fontFamily: font.bodySemi, fontSize: m.s(22), textAlign: 'center', color: outline, transform: [{ translateX: x }, { translateY: y }] }}>
                    {LABEL}
                  </Text>
                ))
              : null}
            <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(22), textAlign: 'center', color: text }}>{LABEL}</Text>
          </View>
        </View>
      </View>
      <View style={{ position: 'absolute', left: m.s(14), right: m.s(14), bottom: m.s(12), height: m.s(3), borderRadius: m.s(3), backgroundColor: 'rgba(255,255,255,0.18)' }}>
        <View style={{ width: '34%', height: '100%', borderRadius: m.s(3), backgroundColor: 'rgba(255,255,255,0.7)' }} />
      </View>
    </View>
  );
}

export function SubtitleColorPicker({
  text,
  bg,
  outline,
  onChange,
  m,
}: {
  text: string;
  bg: string;
  outline: string;
  onChange: (channel: SubChannel, hex: string) => void;
  m: M;
}) {
  const [channel, setChannel] = useState<SubChannel>('text');
  const value = channel === 'text' ? text : channel === 'bg' ? bg : outline;
  return (
    <View>
      <Preview text={text} bg={bg} outline={outline} m={m} />
      <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: colors.textGhost, marginBottom: m.s(10) }}>Color</Text>
      <View style={{ flexDirection: 'row', gap: m.s(6), padding: m.s(4), borderRadius: m.s(12), backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', marginBottom: m.s(16) }}>
        {CHANNELS.map((c) => (
          <SegTab
            key={c.key}
            label={c.label}
            dot={c.key === 'text' ? text : c.key === 'bg' ? bg : outline}
            active={channel === c.key}
            onPress={() => setChannel(c.key)}
            m={m}
          />
        ))}
      </View>
      <ColorSwatchRow presets={SWATCHES[channel]} value={value} m={m} fill atRowStart onChange={(hex) => onChange(channel, hex)} />
    </View>
  );
}
