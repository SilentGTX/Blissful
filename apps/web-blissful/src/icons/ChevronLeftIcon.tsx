type ChevronLeftIconProps = {
  className?: string;
};

export function ChevronLeftIcon({ className }: ChevronLeftIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 18 9 12l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
