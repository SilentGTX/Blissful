type CloseIconProps = {
  className?: string;
  size?: number;
};

export function CloseIcon({ className, size = 16 }: CloseIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
