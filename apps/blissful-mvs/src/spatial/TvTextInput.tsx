// Focusable text input for TV. On D-pad OK it native-focuses the field so the
// Android TV IME opens, and pauses the spatial engine while typing (Esc / Up /
// Down blur back out). On desktop it's just a plain styled <input> — no TV
// behaviour — so the maintained build is unaffected.

import { useRef } from 'react';
import { pause, resume } from '@noriginmedia/norigin-spatial-navigation';
import { useTvFocusable } from './useTvFocusable';
import { isTvMode } from '../lib/platform';

type TvTextInputProps = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Wrapper class. */
  className?: string;
  /** The <input> class (keep the field's original styling here). */
  inputClassName?: string;
  type?: string;
  ariaLabel?: string;
  onSubmit?: () => void;
};

export function TvTextInput({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  type = 'text',
  ariaLabel,
  onSubmit,
}: TvTextInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const tv = isTvMode();
  const { ref } = useTvFocusable({ onPress: () => inputRef.current?.focus() });

  const input = (
    <input
      ref={inputRef}
      value={value}
      type={type}
      aria-label={ariaLabel}
      placeholder={placeholder}
      className={inputClassName}
      onChange={(e) => onChange(e.target.value)}
      onFocus={tv ? () => pause() : undefined}
      onBlur={tv ? () => resume() : undefined}
      onKeyDown={
        tv
          ? (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSubmit?.();
                inputRef.current?.blur();
              }
              if (e.key === 'Escape' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                inputRef.current?.blur();
              }
            }
          : undefined
      }
    />
  );

  if (!tv) {
    return <div className={className}>{input}</div>;
  }
  return (
    <div ref={ref} className={'tv-text-input ' + (className ?? '')}>
      {input}
    </div>
  );
}
