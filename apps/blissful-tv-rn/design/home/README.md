# Blissful TV — React Native (Android TV / tvOS) handoff

The immersive 10-foot home screen, ported to React Native TV. Full-bleed backdrop
that follows focus, large landscape tiles in horizontal rails, a featured info
panel, and an expanding sidebar with a Friends panel.

## Files
| File | Role |
|------|------|
| `BlissfulTVHome.jsx` | Top-level screen — composes everything, owns focus→state lifting |
| `Hero.jsx` | `Backdrop` (full-bleed art of focused item) + `InfoPanel` (featured metadata) |
| `Row.jsx` | `Row` (rail + header with See all) and `Tile` (focusable landscape card) |
| `Sidebar.jsx` | Icon rail that expands to a drawer; nav + Friends panel (tabs, requests) |
| `PosterArt.jsx` | Gradient placeholder artwork — **swap for `<Image>`** |
| `Icon.jsx` | SVG icon set |
| `data.js` | `ROWS`, `NAV`, `FRIENDS`, `REQUESTS` |
| `theme.js` | Tokens: colors, layout dims, `ACCENTS`, art gradient helper |

## Dependencies
```bash
npm i react-native-svg
# Build against react-native-tvos (the TV fork of RN):
#   https://github.com/react-native-tvos/react-native-tvos
```
Fonts: bundle **Spectral** (400/600/700) as `Spectral-Regular/SemiBold/Bold`.
Body copy uses the system sans.

## Usage
```jsx
import BlissfulTVHome from './TVHome/BlissfulTVHome';

export default function App() {
  return <BlissfulTVHome accent="#8aa0ff" />;   // accent is themeable (see ACCENTS)
}
```

## How TV focus works here
React Native TV's **native focus engine** moves focus between `<Pressable focusable>`
nodes when the user presses the D-pad — you do **not** implement spatial navigation
yourself (that was the web prototype's job). Each focusable simply reacts to
`onFocus`/`onBlur`. We use those callbacks to:

1. **Lift the focused item up** — `Tile.onFocus → onFocusItem(item, rowIndex)` sets
   screen state, which re-renders `Backdrop` + `InfoPanel` to that title.
2. **Scroll the row band** — the focused row scrolls to the top via a `ScrollView`
   ref (`scrollEnabled={false}`; movement is focus-driven, not touch).
3. **Expand the sidebar** — the sidebar `onFocus` sets `expanded`, morphing the rail
   (110dp) into the drawer (480dp). Focus leaving it collapses it.

### Recommended hardening for production
- Wrap the sidebar and each rail in **`<TVFocusGuideView>`** so focus is trappable
  and the OS remembers the last-focused child when you return to a row
  (`autoFocus`/`destinations`). This gives the "resume where I was" feel.
- Set **`hasTVPreferredFocus`** on the first tile (already wired via `firstFocus`)
  so the screen has focus on mount.
- For long catalogs, replace the `Row`'s `View` rail with a **horizontal `FlatList`**
  (`removeClippedSubviews`, `initialNumToRender`) — the focus contract is identical.
- Handle the **back button** (`BackHandler` / `TVMenuControl`) to collapse the
  sidebar or exit.

## Known substitutions (placeholders → real)
- **`PosterArt` / `Backdrop`** draw gradient placeholders with `react-native-svg`.
  Replace with `<Image source={{uri:item.img}} resizeMode="cover" />` once you have
  artwork; add an `img` field per item in `data.js`.
- **Scrims**: `Hero.jsx` leaves the left/bottom legibility scrims as transparent
  `View`s (RN has no CSS gradient). Add **`expo-linear-gradient`** (or
  `react-native-linear-gradient`) and drop two `<LinearGradient>` overlays in
  `Backdrop` — one left→right, one bottom→top — to match the prototype.
- The drawer **width/opacity transition** is instant here; animate `width` with
  `Animated`/Reanimated and a layout transition for the morph.

## Layout reference
Designed against **1920×1080 dp**. Key dims live in `theme.js → layout`
(`railWidth`, `drawerWidth`, `tileW/H`, `tileGap`, `rowStep`, `rowsTop`). If you
target multiple TV resolutions, wrap these in a scale factor based on screen width.
