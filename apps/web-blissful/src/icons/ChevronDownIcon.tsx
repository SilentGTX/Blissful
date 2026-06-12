type ChevronDownIconProps = {
  className?: string;
  size?: number;
};

export function ChevronDownIcon({ className, size = 12 }: ChevronDownIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M6 9l6 6 6-6" fill="currentColor" />
    </svg>
  );
}
