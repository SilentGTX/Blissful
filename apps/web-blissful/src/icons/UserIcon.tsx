type UserIconProps = {
  className?: string;
};

export function UserIcon({ className }: UserIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm6 8a6 6 0 0 0-12 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
