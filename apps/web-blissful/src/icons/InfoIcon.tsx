type InfoIconProps = {
  className?: string;
  size?: number;
};

export function InfoIcon({ className, size = 16 }: InfoIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M12 7.25a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm-1 3.25a1 1 0 0 1 2 0v7a1 1 0 1 1-2 0v-7Zm1-8.25a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z"
        fill="currentColor"
      />
    </svg>
  );
}
