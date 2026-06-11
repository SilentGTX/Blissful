// Full-screen iframe wrapper around vidking.net's embeddable player.
// URL patterns:
//   /vidking/movie/<tmdbId>
//   /vidking/tv/<tmdbId>/<season>/<episode>
// Renders <iframe src="https://www.vidking.net/embed/..."> and a back
// button. Their player resolves + serves the stream itself, so we
// don't go through any of our HLS / probe / RD-resolve pipeline.

import { useNavigate, useParams } from 'react-router-dom';
import { useCallback } from 'react';

export default function VidkingPlayerPage() {
  const navigate = useNavigate();
  const params = useParams<{
    type: 'movie' | 'tv';
    tmdbId: string;
    seasonId?: string;
    episodeId?: string;
  }>();

  const onBack = useCallback(() => navigate(-1), [navigate]);

  const type = params.type ?? 'movie';
  const tmdbId = params.tmdbId ?? '';
  const seasonId = params.seasonId;
  const episodeId = params.episodeId;

  if (!tmdbId) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black text-white">
        <button
          type="button"
          className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm"
          onClick={onBack}
        >
          Back
        </button>
        <div className="ml-4 text-sm text-white/70">Missing TMDB id.</div>
      </div>
    );
  }

  const embedUrl =
    type === 'tv' && seasonId && episodeId
      ? `https://www.vidking.net/embed/tv/${encodeURIComponent(tmdbId)}/${encodeURIComponent(seasonId)}/${encodeURIComponent(episodeId)}`
      : `https://www.vidking.net/embed/movie/${encodeURIComponent(tmdbId)}`;

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      <iframe
        title="Vidking Player"
        src={embedUrl}
        className="h-full w-full border-0"
        // Vidking explicitly warns that sandbox attributes break their
        // player (we saw the string in their bundle). Allow what their
        // player actually needs.
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
      <button
        type="button"
        className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-3 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/15"
        onClick={onBack}
      >
        ← Back
      </button>
    </div>
  );
}
