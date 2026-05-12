type ArrowRightIconProps = {
  className?: string;
};

export function ArrowRightIcon({ className }: ArrowRightIconProps) {
  return (
    <svg className={className} viewBox="0 0 512 512" aria-hidden="true">
      <path
        d="M184 112l144 143.999L184 400"
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
