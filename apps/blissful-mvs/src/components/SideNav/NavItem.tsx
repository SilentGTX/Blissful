import { Tooltip } from '@heroui/react';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { ContinueIcon } from '../../icons/ContinueIcon';
import { FriendsIcon } from '../../icons/FriendsIcon';
import { StrokeIcon } from '../../icons/StrokeIcon';
import { useGlitchText } from '../../lib/useGlitchText';

type NavItemProps = {
  label: string;
  icon: string;
  active: boolean;
  collapsed: boolean;
  onPress: () => void;
};

export function NavItem(props: NavItemProps) {
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const displayLabel = useGlitchText(props.label, isHovering && !props.active);

  const button = (
    <button
      type="button"
      onClick={props.onPress}
      onMouseEnter={() => {
        setIsHovering(true);
        if (props.collapsed) setIsTooltipOpen(true);
      }}
      onMouseLeave={() => {
        setIsHovering(false);
        setIsTooltipOpen(false);
      }}
      onFocus={() => {
        setIsHovering(true);
        if (props.collapsed) setIsTooltipOpen(true);
      }}
      onBlur={() => {
        setIsHovering(false);
        setIsTooltipOpen(false);
      }}
      className={
        // Height clamps with the larger of viewport-height (3vh)
        // and viewport-width (1.6vw) factors — scales on both tall
        // monitors and 4K TVs while staying tight enough that the
        // active pill hugs the icon vertically. Ceiling caps at
        // 3.25rem so even at 4K the row doesn't grow taller than
        // needed.
        'bliss-sidebar-link relative cursor-pointer mx-4 flex h-[clamp(2rem,max(3vh,1.6vw),3.25rem)] w-[calc(100%-2rem)] items-center rounded-2xl transition-colors duration-300' +
        (props.active ? ' is-active' : '')
      }
      aria-label={props.label}
    >
      {/* Active-state pill. Framer Motion's `layoutId` shares the
          element across all NavItems so when `active` flips from one
          row to another the pill slides between them with a spring,
          rather than the active background instant-cutting. */}
      {props.active ? (
        <motion.div
          layoutId="nav-active-desktop"
          className="absolute inset-0 rounded-2xl bg-white/[0.08] ring-1 ring-white/10"
          style={{ willChange: 'transform' }}
          transition={{ type: 'spring', stiffness: 500, damping: 44 }}
        />
      ) : null}
      {/* `nav-icon-slot` defines the fixed-width slot whose width
          = collapsed-sidebar button content width. Icon size clamps
          with viewport: 20px on a laptop → up to 32px on a 4K TV.
          Since the icon is `justify-center`'d in the slot, scaling
          its size just grows the icon symmetrically around the same
          center — no horizontal jump during collapse/expand.
          `relative z-10` keeps the icon ABOVE the motion pill. */}
      <div className="nav-icon-slot relative z-10 flex h-full shrink-0 items-center justify-center">
        <StrokeIcon path={props.icon} className="h-[clamp(1.25rem,1.1vw,2rem)] w-[clamp(1.25rem,1.1vw,2rem)]" />
      </div>
      <span className="bliss-sidebar-label relative z-10 font-semibold">
        <span className="bliss-sidebar-label-text">{displayLabel}</span>
        <span className="bliss-sidebar-glitch-cursor" aria-hidden="true" />
      </span>
    </button>
  );

  return (
    <li className="relative">
      {props.collapsed ? (
        <Tooltip isOpen={isTooltipOpen} delay={0} closeDelay={0}>
          <Tooltip.Trigger>
            {button}
          </Tooltip.Trigger>
          <Tooltip.Content
            placement="right"
            UNSTABLE_portalContainer={document.body}
            className="bg-white/10 text-white px-3 py-2 rounded-xl text-sm font-medium backdrop-blur-md"
          >
            {props.label}
          </Tooltip.Content>
        </Tooltip>
      ) : (
        button
      )}
    </li>
  );
}

type MobileNavItemProps = {
  label: string;
  icon: string;
  active: boolean;
  onPress: () => void;
};

export function MobileNavItem(props: MobileNavItemProps) {
  return (
    <button
      type="button"
      onClick={props.onPress}
      className={
        'relative flex h-14 min-w-[44px] flex-1 flex-col items-center justify-center gap-1 transition-colors duration-200 ' +
        (props.active
          ? 'text-[var(--bliss-accent)] drop-shadow-[0_0_12px_var(--bliss-accent-glow)]'
          : 'text-white/50 hover:text-white/80')
      }
      aria-label={props.label}
    >
      {props.active ? (
        <motion.div
          layoutId="nav-active-mobile"
          className="absolute inset-x-2 inset-y-1.5 rounded-2xl bg-white/[0.06]"
          style={{ willChange: 'transform' }}
          transition={{ type: 'spring', stiffness: 520, damping: 46 }}
        />
      ) : null}
      <div className="relative z-10">
        <StrokeIcon path={props.icon} size={24} />
      </div>
      <span className="relative z-10 text-[10px] font-medium">{props.label}</span>
    </button>
  );
}

type MobileContinueItemProps = {
  count: number;
  onPress: () => void;
};

export function MobileContinueItem(props: MobileContinueItemProps) {
  return (
    <button
      type="button"
      onClick={props.onPress}
      className="flex h-14 min-w-[44px] flex-1 flex-col items-center justify-center gap-1 transition duration-200 text-white/50 hover:text-white/80 relative"
      aria-label="Continue"
    >
      <div className="relative">
        <ContinueIcon size={24} />
        {props.count > 0 ? (
          <div className="absolute -right-1.5 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-white text-[9px] font-semibold text-black">
            {props.count > 99 ? '99+' : props.count}
          </div>
        ) : null}
      </div>
      <span className="text-[10px] font-medium">Continue</span>
    </button>
  );
}

type MobileFriendsItemProps = {
  count: number;
  onPress: () => void;
};

export function MobileFriendsItem(props: MobileFriendsItemProps) {
  return (
    <button
      type="button"
      onClick={props.onPress}
      className="flex h-14 min-w-[44px] flex-1 flex-col items-center justify-center gap-1 transition duration-200 text-white/50 hover:text-white/80 relative"
      aria-label="Friends"
    >
      <div className="relative">
        <FriendsIcon size={24} />
        {props.count > 0 ? (
          <div className="absolute -right-1.5 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-white text-[9px] font-semibold text-black">
            {props.count > 99 ? '99+' : props.count}
          </div>
        ) : null}
      </div>
      <span className="text-[10px] font-medium">Friends</span>
    </button>
  );
}
