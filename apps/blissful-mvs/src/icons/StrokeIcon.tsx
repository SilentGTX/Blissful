type StrokeIconProps = {
  path: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
};

export function StrokeIcon({ path, size = 20, strokeWidth = 1.8, className }: StrokeIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
