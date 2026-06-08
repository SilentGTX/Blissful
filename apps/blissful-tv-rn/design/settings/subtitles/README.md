# SubtitleColorPicker — React Native handoff

Compact subtitle color picker (variant A): one palette switched between **Text /
Background / Outline** via a sliding segmented control, with a live caption preview.

## Install
```bash
npm i react-native-svg
# iOS:
npx pod-install
```

## Use
```jsx
import SubtitleColorPicker from './SubtitleColorPicker';

// Controlled
const [colors, setColors] = useState({ text: '#ffffff', bg: 'none', outline: '#0b0b0d' });
<SubtitleColorPicker value={colors} onChange={setColors} />

// Uncontrolled (manages its own state)
<SubtitleColorPicker />
```

## Value shape
```ts
{
  text:    string;            // hex, always set
  bg:      string | 'none';   // 'none' = transparent background
  outline: string | 'none';   // 'none' = no outline
}
```

## Notes for the implementer
- **Tokens** are exported: `ACCENT` (selection ring) and `SWATCHES` (the 10 colors).
  Swap `SWATCHES` to rebrand the palette; everything else follows.
- **Selected state**: 2px `ACCENT` ring with a 2px gap + a contrast-aware checkmark
  (white on dark colors, black on light). The card background shows through the gap.
- **Outline** in the preview is faked with 4 offset `<Text>` copies behind the fill,
  since RN has no multi-direction text stroke. If you already have a caption renderer
  in the player, drive it from these values instead of this preview.
- **Dropdowns** (Language / Size) are visual stubs — wire them to your existing
  pickers/sheets. The `文A` / `Aa` glyphs are placeholders; replace with your icons.
- Width is fixed at 440; wrap in a flex container or change `s.card.width` to `'100%'`
  for full-bleed sheets.
- Card colors are inline hex for portability — move them into your theme tokens.
