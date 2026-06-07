import type { ReactNode } from 'react';
import { TVFocusGuideView, type StyleProp, type ViewStyle } from 'react-native';

// Wraps a modal/overlay's focusable content so the D-pad can NEVER escape it to
// elements behind the overlay (the tvos focus engine otherwise happily jumps to
// a still-focusable card/chip underneath). Trap all four directions — overlays
// are dismissed with the close button or Back, never by navigating out of them.
// `autoFocus` pulls focus back inside if it ever lands outside the guide.
export function FocusTrap({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
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
