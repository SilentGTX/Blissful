type FriendsIconProps = {
  className?: string;
  size?: number;
};

export function FriendsIcon({ className, size = 18 }: FriendsIconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
    >
      {/* Two overlapping shoulders silhouette — front-and-slightly-back
          arrangement reads as "people" / "friends" at small sizes. */}
      <circle cx="9" cy="8" r="3.5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M3 20a6 6 0 0 1 12 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M16 11a3 3 0 1 0 0-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M17 14h.5a4.5 4.5 0 0 1 4.5 4.5V20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
