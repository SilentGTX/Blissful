import { useEffect, type ReactNode } from 'react';
import { TVFocusGuideView, type StyleProp, type ViewStyle } from 'react-native';
import { pushOverlay } from '../lib/overlayStore';

// Wraps a modal/overlay's focusable content so the D-pad can NEVER escape it to
// elements behind the overlay (the tvos focus engine otherwise happily jumps to
// a still-focusable card/chip underneath). Trap all four directions — overlays
// are dismissed with the close button or Back, never by navigating out of them.
// `autoFocus` pulls focus back inside if it ever lands outside the guide.
//
// Also registers the overlay so the NavRail suppresses its global open-on-Left
// gesture while a modal is up (the rail's Left listener is key-based, not focus-
// based, so the trap alone can't stop a Left from opening the sidebar behind us).
export function FocusTrap({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  useEffect(() => pushOverlay(), []);
  return (
    <TVFocusGuideView
      style={style}
      autoFocus
      trapFocusUp
      trapFocusDown
      trapFocusLeft
      trapFocusRight
    >
      {children}
    </TVFocusGuideView>
  );
}
