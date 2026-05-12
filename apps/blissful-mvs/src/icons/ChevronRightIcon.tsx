type ChevronRightIconProps = {
  className?: string;
};

export function ChevronRightIcon({ className }: ChevronRightIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
