import type { ComponentProps, ReactNode } from 'react';
import { Switch } from '@heroui/react';
import { cn } from '@heroui/styles';

export type BlissSwitchProps = Omit<ComponentProps<typeof Switch>, 'children'> & {
  /** Caption shown to the left of the toggle. Omit for a bare switch. */
  label?: ReactNode;
};

// The app's accent toggle: an oversized track that turns periwinkle when
// on, with a sliding thumb. The sizes/colors use `!` overrides because
// HeroUI's .switch__control / .switch__thumb selectors out-specify plain
// utilities. Pass `label` for the standard left caption; for anything more
// exotic, compose with the re-exported Control/Thumb/Content parts.
function SwitchRoot({ label, className, ...props }: BlissSwitchProps) {
  return (
    <Switch className={cn('flex h-8 cursor-pointer items-center gap-2', className)} {...props}>
      {({ isSelected }) => (
        <>
          {label != null ? (
            <Switch.Content>
              <span className="cursor-pointer text-[13px] font-medium text-white">{label}</span>
            </Switch.Content>
          ) : null}
          <Switch.Control
            className={`!h-8 !w-14 ${isSelected ? '!bg-[var(--bliss-accent)] shadow-lg' : '!bg-white/20'}`}
          >
            <Switch.Thumb
              className={`!h-6 !w-6 ${isSelected ? '!ms-[calc(100%-1.75rem)] !bg-black' : '!ms-1 !bg-white'}`}
            />
          </Switch.Control>
        </>
      )}
    </Switch>
  );
}

export const BlissSwitch = Object.assign(SwitchRoot, {
  Control: Switch.Control,
  Thumb: Switch.Thumb,
  Content: Switch.Content,
});
