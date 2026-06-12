type ThemeIconProps = {
  isDark: boolean;
  className?: string;
};

export function ThemeIcon({ isDark, className }: ThemeIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      {isDark ? (
        <path
          d="M20 14.5A8.5 8.5 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.657-5.657L19.07 4.93M4.93 19.07l1.414-1.414M17.657 17.657l1.414 1.414M4.93 4.93l1.414 1.414M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
