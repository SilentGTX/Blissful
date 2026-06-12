type ArrowLeftIconProps = {
  className?: string;
};

export function ArrowLeftIcon({ className }: ArrowLeftIconProps) {
  return (
    <svg className={className} viewBox="0 0 512 512" aria-hidden="true">
      <path
        d="M328 112 184 255.999l144 144"
        style={{
          stroke: 'currentColor',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeWidth: 48,
          fill: 'none',
        }}
      />
    </svg>
  );
}
