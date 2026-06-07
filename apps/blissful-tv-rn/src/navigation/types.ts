import type { MediaType } from '@blissful/core';

export type RootStackParamList = {
  Home: undefined;
  Detail: { id: string; type: MediaType; name: string; poster?: string };
  Player: {
    url: string;
    title: string;
    // Optional ranked playable list + start index. When present the player can
    // auto-advance past a stream that loads as the ~30s debrid DMCA placeholder.
    playlist?: { url: string; title: string }[];
    startIndex?: number;
  };
  Login: undefined;
  Search: { query?: string } | undefined;
  Discover: { type: MediaType; genre?: string } | undefined;
};
