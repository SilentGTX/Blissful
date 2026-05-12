import { Spinner } from '@heroui/react';

export default function LoadingRow() {
  return (
    <div className="flex w-full items-center justify-center py-16">
      <Spinner
        size="lg"
        color="current"
        className="text-[var(--bliss-teal)] drop-shadow-[0_0_12px_var(--bliss-teal-glow)]"
      />
    </div>
  );
}
