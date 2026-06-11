import { BlissSpinner } from './base';

export default function LoadingRow() {
  return (
    <div className="flex w-full items-center justify-center py-16">
      <BlissSpinner size="lg" />
    </div>
  );
}
