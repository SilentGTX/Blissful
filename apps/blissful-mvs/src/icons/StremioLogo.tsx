import stremioLogoUrl from '../assets/stremio_symbol.png';

// Stremio's diamond+play mark. Sourced from
// apps/blissful-mvs/src/assets/stremio_symbol.png (PNG with alpha,
// imported by Vite as a URL). Used in the Settings -> Linked accounts
// panel and the /link-stremio popup.

type Props = {
  className?: string;
  size?: number;
};

export function StremioLogo({ className, size = 24 }: Props) {
  return (
    <img
      src={stremioLogoUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden
      className={className}
      style={{ display: 'inline-block' }}
    />
  );
}