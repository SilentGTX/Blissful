import { ChevronLeftIcon } from './ChevronLeftIcon';
import { ChevronRightIcon } from './ChevronRightIcon';

type CollapseIconProps = {
  collapsed: boolean;
  className?: string;
};

export function CollapseIcon({ collapsed, className }: CollapseIconProps) {
  return collapsed ? (
    <ChevronRightIcon className={className} />
  ) : (
    <ChevronLeftIcon className={className} />
  );
}
