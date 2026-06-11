import { useCallback, useState } from 'react';

type ExternalOpenPrompt = {
  title: string;
  url: string;
  reason: string;
  internalPlayerLink: string | null;
} | null;

export function useExternalOpenPrompt() {
  const [externalOpenPrompt, setExternalOpenPrompt] = useState<ExternalOpenPrompt>(null);

  const openExternalPrompt = useCallback(
    (value: {
      title: string;
      url: string;
      reason: string;
      internalPlayerLink: string | null;
    }) => {
      setExternalOpenPrompt(value);
    },
    []
  );

  const closeExternalPrompt = useCallback(() => setExternalOpenPrompt(null), []);

  return { externalOpenPrompt, openExternalPrompt, closeExternalPrompt };
}
