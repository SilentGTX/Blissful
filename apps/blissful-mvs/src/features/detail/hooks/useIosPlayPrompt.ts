import { useCallback, useState } from 'react';
import type { WhatToDoPrompt } from '../../../components/WhatToDoDrawer';

export function useIosPlayPrompt() {
  const [iosPlayPrompt, setIosPlayPrompt] = useState<WhatToDoPrompt>(null);

  const openIosPrompt = useCallback((prompt: WhatToDoPrompt) => {
    setIosPlayPrompt(prompt);
  }, []);

  const closeIosPrompt = useCallback(() => setIosPlayPrompt(null), []);

  return { iosPlayPrompt, openIosPrompt, closeIosPrompt };
}
