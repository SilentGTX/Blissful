// Initials-on-tinted-circle avatar with an optional online dot
// overlay. Used everywhere we render a person in the friends UI.
//
// Size accepts either a number (legacy fixed-px) or a CSS length
// string (e.g. "clamp(1.5rem,3vh,2rem)") so the sidebar can scale
// avatars with viewport. The initial font-size + online-dot size
// are both derived from a single `--avatar-size` CSS variable so
// any unit works.

type Props = {
  displayName: string;
  size?: number | string;
  online?: boolean;
};

export function FriendAvatar({ displayName, size = 24, online }: Props) {
  const initial = (displayName || '?').slice(0, 1).toUpperCase();
  const sizeValue = typeof size === 'number' ? `${size}px` : size;
  const style = { '--avatar-size': sizeValue } as React.CSSProperties;
  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ ...style, width: 'var(--avatar-size)', height: 'var(--avatar-size)' }}
    >
      <span
        className="inline-flex h-full w-full items-center justify-center rounded-full bg-white/15 font-semibold leading-none text-white"
        style={{ fontSize: 'calc(var(--avatar-size) * 0.45)' }}
        aria-hidden
      >
        {initial}
      </span>
      {online ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-[#101116] bg-emerald-400"
          style={{
            width: 'max(8px, calc(var(--avatar-size) * 0.32))',
            height: 'max(8px, calc(var(--avatar-size) * 0.32))',
          }}
          aria-label="Online"
        />
      ) : null}
    </span>
  );
}
