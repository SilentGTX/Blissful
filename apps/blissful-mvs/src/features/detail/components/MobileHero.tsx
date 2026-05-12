import type { ReactNode } from 'react';

type MobileHeroProps = {
  heroPoster: string | null;
  logo: string | null;
  logoTitle: string;
  logoFailed: boolean;
  onLogoError: () => void;
  displayName: string;
  children?: ReactNode;
};

export function MobileHero({
  heroPoster,
  logo,
  logoTitle,
  logoFailed,
  onLogoError,
  displayName,
  children,
}: MobileHeroProps) {
  if (!heroPoster) return null;

  return (
    <div className="relative -mx-4 lg:hidden">
      <div
        className="relative h-[55vh] bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${heroPoster})` }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 via-black/30 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[22rem] bg-gradient-to-t from-[#0b0f14] via-[#0b0f14]/80 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 z-20 px-4">
          {logo && !logoFailed ? (
            <img
              title={logoTitle}
              className="logo-X3hTV"
              src={logo}
              alt=" "
              loading="lazy"
              onError={onLogoError}
            />
          ) : (
            <div className="flex items-center gap-3">
              <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-sky-400/30 via-violet-400/30 to-amber-400/30 flex items-center justify-center text-xl font-bold text-white/80">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div className="text-2xl font-semibold tracking-tight text-white drop-shadow-lg">
                {displayName}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="-mt-14 relative z-10 rounded-t-[28px] bg-[#0b0f14] px-4 pt-6">
        <div className="pointer-events-none absolute inset-x-0 -top-10 h-10 bg-gradient-to-b from-transparent to-[#0b0f14]" />
        <div className="lg:hidden">{children}</div>
      </div>
    </div>
  );
}
