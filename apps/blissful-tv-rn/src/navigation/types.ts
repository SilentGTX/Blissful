import type { MediaType } from '@blissful/core';

export type RootStackParamList = {
  Home: undefined;
  // `season`/`episode` pre-select that episode when returning from the player
  // (mirrors the desktop's `/detail/:type/:id?videoId=` deep link).
  Detail: { id: string; type: MediaType; name: string; poster?: string; season?: number; episode?: number };
  Player: {
    url: string;
    title: string;
    // Optional ranked playable list + start index. When present the player can
    // auto-advance past a stream that loads as the ~30s debrid DMCA placeholder.
    playlist?: { url: string; title: string }[];
    startIndex?: number;
    // The title's landscape logo (buffering veil) + backdrop, from the detail meta.
    logo?: string | null;
    background?: string | null;
    // Portrait poster — written to the library item so Continue Watching has a
    // thumbnail when the player auto-creates the progress entry.
    poster?: string | null;
    startSeconds?: number; // resume position (Continue Watching)
    // Pause-overlay metadata (from the detail/CW meta).
    description?: string | null;
    releaseInfo?: string | null;
    imdbId?: string | null;
    rating?: string | null;
    // The media this is playing — lets the player re-open the stream picker to
    // switch release mid-playback (the Sources/Releases button).
    streamTarget?: { type: MediaType; id: string; title: string; episodeLabel?: string | null };
    // The title's DETAIL-page id (the show id for series — NOT the episode video
    // id) so Back always lands on the right Detail page (mirrors the desktop
    // NativeMpvPlayer.onBack: navigate(`/detail/:type/:id`), never goBack()).
    detailId?: string;
  };
  Login: undefined;
  Search: { query?: string } | undefined;
  Discover: { type: MediaType; genre?: string } | undefined;
  Settings: undefined;
  Library: undefined;
  Addons: undefined;
};
