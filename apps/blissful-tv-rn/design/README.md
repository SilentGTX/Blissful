# React Native handoff — Blissful

Drop-in React Native components matching the reworked settings designs.
Both are self-contained, controlled-or-uncontrolled, and theme-token driven.

| File | Screen | Dependency |
|------|--------|------------|
| `AppearanceSettings.jsx` | Appearance — Accent color + Glass surface pickers, live previews | `react-native-svg` |
| `SubtitleColorPicker.jsx` | Subtitles — Text / Background / Outline switcher + caption preview | `react-native-svg` |

## Install
```bash
npm i react-native-svg
npx pod-install            # iOS
# optional (real frosted glass in AppearanceSettings): npm i expo-blur
```

## Use
```jsx
import AppearanceSettings from './AppearanceSettings';
import SubtitleColorPicker from './SubtitleColorPicker';

// controlled — wire to your theme / settings store
<AppearanceSettings
  accent={theme.accent}   onAccentChange={setAccent}
  surface={theme.surface} onSurfaceChange={setSurface}
/>

<SubtitleColorPicker value={subColors} onChange={setSubColors} />

// both also work uncontrolled (self-managed state) with no props
```

## Shared conventions
- **Tokens are exported** from each file (`ACCENTS`, `SURFACES`, `ACCENT_DEFAULT`,
  `SURFACE_DEFAULT`, `SWATCHES`) — swap these to rebrand the palettes.
- **Selection** = ring + gap + contrast-aware checkmark (auto white/black per swatch).
- Colors are inline hex for portability — move them into your theme tokens.
- `AppearanceSettings` glass preview approximates blur with a translucent View;
  swap for `expo-blur`'s `<BlurView>` for true frosting (inline note in the file).
