import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useTvFocusable } from './useTvFocusable';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  /** Click + D-pad-OK handler (replaces onClick). */
  onPress?: () => void;
  /** Claim focus on mount (route-entry element). */
  autoFocusTv?: boolean;
  /** Set false to keep it non-focusable on TV (e.g. disabled). */
  focusableTv?: boolean;
  /** Stable Norigin focusKey so other elements can target it (e.g. UP from the
   *  top rail → the hero "Watch now"). */
  focusKeyTv?: string;
  children?: ReactNode;
};

/**
 * A `<button>` that is D-pad focusable on TV (and inert on desktop/browser — the
 * onPress still fires on mouse click everywhere). Drop-in replacement for the
 * app's existing `<button onClick>` action buttons.
 */
export function FocusableButton({
  onPress,
  autoFocusTv = false,
  focusableTv = true,
  focusKeyTv,
  children,
  ...rest
}: Props) {
  const { ref } = useTvFocusable({ onPress, autoFocus: autoFocusTv, focusable: focusableTv, focusKey: focusKeyTv });
  return (
    <button type="button" ref={ref} onClick={onPress} {...rest}>
      {children}
    </button>
  );
}
