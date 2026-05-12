type PlayIconProps = {
  className?: string;
  size?: number;
};

export function PlayIcon({ className, size = 16 }: PlayIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" />
    </svg>
  );
}
