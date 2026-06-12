export type MediaType = string;

export type MediaItem = {
  id: string;
  type: MediaType;
  title: string;
  year?: number;
  rating?: number;
  genres?: string[];
  runtime?: string;
  seasons?: number;
  posterUrl?: string;
  blurb?: string;
};
