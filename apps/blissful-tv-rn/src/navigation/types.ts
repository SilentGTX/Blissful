import type { MediaType } from '@blissful/core';

export type RootStackParamList = {
  Home: undefined;
  Detail: { id: string; type: MediaType; name: string; poster?: string };
  Player: { url: string; title: string };
  Login: undefined;
};
