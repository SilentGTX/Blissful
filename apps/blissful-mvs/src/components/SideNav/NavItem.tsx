import { Tooltip } from '@heroui/react';
import { useState } from 'react';
import { ContinueIcon } from '../../icons/ContinueIcon';
import { StrokeIcon } from '../../icons/StrokeIcon';

type NavItemProps = {
  label: string;
  icon: string;
  active: boolean;
  collapsed: boolean;
  onPress: () => void;
};

export function NavItem(props: NavItemProps) {
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  const button = (
    <button
      type="button"
      onClick={props.onPress}
      onMouseEnter={() => {
        if (props.collapsed) setIsTooltipOpen(true);
      }}
      onMouseLeave={() => setIsTooltipOpen(false)}
      onFocus={() => {
        if (props.collapsed) setIsTooltipOpen(true);
      }}
      onBlur={() => setIsTooltipOpen(false)}
      className={
        'bliss-sidebar-link cursor-pointer mx-4 flex h-11 w-[calc(100%-2rem)] items-center rounded-2xl transition duration-300' +
        (props.active ? ' is-active' : '')
      }
      aria-label={props.label}
    >
      <div className="p-4">
        <StrokeIcon path={props.icon} />
      </div>
      <span className="bliss-sidebar-label font-semibold">{props.label}</span>
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
        'flex h-14 min-w-[44px] flex-1 flex-col items-center justify-center gap-1 transition duration-200 ' +
        (props.active
          ? 'text-[var(--bliss-teal)] drop-shadow-[0_0_12px_var(--bliss-teal-glow)]'
          : 'text-white/50 hover:text-white/80')
      }
      aria-label={props.label}
    >
      <StrokeIcon path={props.icon} size={24} />
      <span className="text-[10px] font-medium">{props.label}</span>
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
