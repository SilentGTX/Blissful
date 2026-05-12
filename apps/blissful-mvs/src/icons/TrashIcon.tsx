type TrashIconProps = {
  className?: string;
  size?: number;
};

export function TrashIcon({ className, size = 20 }: TrashIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
      <path
        d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
