import { useRailOpen } from './railStore';
import { useLoginOpen } from './loginStore';

// Whether on-screen content focusables should go inert (isTVSelectable={false}).
// True when the nav rail is open OR the login modal is open. The login modal
// hosts TextInputs whose soft keyboard (IME) can fling D-pad focus past the
// <FocusTrap> on Android TV — so trapping alone isn't enough; we also make the
// screen behind non-focusable, exactly like the rail does, so focus has nowhere
// to escape to. Mirrors useRailOpen so existing `!railOpen` gates just swap in.
export function useContentInert(): boolean {
  const railOpen = useRailOpen();
  const loginOpen = useLoginOpen();
  return railOpen || loginOpen;
}
