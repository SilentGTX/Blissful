import type { ReactNode } from 'react';

type MobileHeroProps = {
  heroPoster: string | null;
  logo: string | null;
  logoTitle: string;
  logoFailed: boolean;
  onLogoError: () => void;
  children?: ReactNode;
};

export function MobileHero({
  heroPoster,
  logo,
  logoTitle,
  logoFailed,
  onLogoError,
  children,
}: MobileHeroProps) {
  if (!heroPoster) return null;

  return (
    <div className="relative -mx-4 lg:hidden">
      <div
        className="relative h-[55dvh] bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${heroPoster})` }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 via-black/30 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[22rem] bg-gradient-to-t from-[#0b0f14] via-[#0b0f14]/80 to-transparent" />

        {/* flex justify-center keeps the title logo centred regardless
            of viewport -- the legacy .logo-X3hTV is display:block, which
            would otherwise leave wide logos (OBSESSION etc.) flush left
            at medium widths. */}
        <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center px-4">
          {logo && !logoFailed ? (
            <img
              title={logoTitle}
              className="logo-X3hTV"
              src={logo}
              alt=" "
              loading="lazy"
              onError={onLogoError}
            />
          ) : null}
        </div>
      </div>

      <div className="-mt-14 relative z-10 rounded-t-[28px] bg-[#0b0f14] px-4 pt-6">
        <div className="pointer-events-none absolute inset-x-0 -top-10 h-10 bg-gradient-to-b from-transparent to-[#0b0f14]" />
        <div className="lg:hidden">{children}</div>
      </div>
    </div>
  );
}
