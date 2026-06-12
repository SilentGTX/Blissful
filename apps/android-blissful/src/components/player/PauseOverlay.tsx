import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';
import { Img } from '../Img';
import { Rating } from '../Rating';
import { font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';

// 1:1 of the old NativeMpvPlayer/PauseOverlay: bottom-up scrim + bottom-left title
// logo, a meta line, and a clamped description — shown only while paused. For a
// SERIES it shows the CURRENT EPISODE (Season N · Episode M · runtime, the episode
// title, the episode summary), matching the web; for a movie it shows release ·
// rating · runtime + the show summary.
export function PauseOverlay({
  visible,
  logo,
  title,
  description,
  releaseInfo,
  imdbId,
  rating,
  duration,
  episodeLabel,
  episodeTitle,
}: {
  visible: boolean;
  logo?: string | null;
  title: string;
  description?: string | null;
  releaseInfo?: string | null;
  imdbId?: string | null;
  rating?: string | null;
  duration: number;
  /** Series: "Season 4 · Episode 7" — when set, the meta line + title go episode-mode. */
  episodeLabel?: string | null;
  /** Series: the episode's own title ("Best Laid Plans"). */
  episodeTitle?: string | null;
}) {
  const m = useMetrics();
  if (!visible) return null;

  const runtime = formatRuntime(duration);
  const isEpisode = Boolean(episodeLabel);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={['rgba(0,0,0,0.2)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.8)']}
        style={StyleSheet.absoluteFill}
      />
      <View style={{ position: 'absolute', left: m.s(56), bottom: m.s(170), maxWidth: '60%' }}>
        {logo ? (
          <Img uri={logo} style={{ width: m.s(380), height: m.s(150), marginBottom: m.s(18) }} contentFit="contain" />
        ) : (
          <Text style={{ fontFamily: font.serif, fontSize: m.s(48), color: '#fff', marginBottom: m.s(14) }} numberOfLines={2}>
            {title}
          </Text>
        )}

        {/* Meta line — "Season 4 · Episode 7 · 50m" (series) or "2022– · rating · 50m" (movie). */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(10), marginBottom: m.s(8) }}>
          {isEpisode ? (
            <>
              <Text style={metaText(m)}>{episodeLabel}</Text>
              {runtime ? <><Text style={dotText(m)}>·</Text><Text style={metaText(m)}>{runtime}</Text></> : null}
            </>
          ) : (
            <>
              {releaseInfo ? <Text style={metaText(m)}>{releaseInfo}</Text> : null}
              {releaseInfo && (rating || imdbId) ? <Text style={dotText(m)}>·</Text> : null}
              {rating || imdbId ? <Rating imdbId={imdbId ?? null} initialRating={rating ?? null} size="md" /> : null}
              {(rating || imdbId) && runtime ? <Text style={dotText(m)}>·</Text> : null}
              {runtime ? <Text style={metaText(m)}>{runtime}</Text> : null}
            </>
          )}
        </View>

        {/* Episode title (+ rating if available) — series only. */}
        {isEpisode && episodeTitle ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(12), marginBottom: m.s(10) }}>
            <Text numberOfLines={1} style={{ fontFamily: font.bodySemi, fontSize: m.s(34), color: '#fff' }}>{episodeTitle}</Text>
            {rating || imdbId ? <Rating imdbId={imdbId ?? null} initialRating={rating ?? null} size="md" /> : null}
          </View>
        ) : null}

        {description ? (
          <Text numberOfLines={4} style={{ fontFamily: font.body, fontSize: m.s(22), color: 'rgba(255,255,255,0.7)', maxWidth: m.s(680), lineHeight: m.s(30) }}>
            {description}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function formatRuntime(totalSeconds: number): string | null {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
  const h = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  if (h <= 0) return `${mm}m`;
  return `${h}h ${mm.toString().padStart(2, '0')}m`;
}
function metaText(m: ReturnType<typeof useMetrics>) {
  return { fontFamily: font.body, fontSize: m.s(24), color: 'rgba(255,255,255,0.8)' } as const;
}
function dotText(m: ReturnType<typeof useMetrics>) {
  return { fontFamily: font.body, fontSize: m.s(24), color: 'rgba(255,255,255,0.4)' } as const;
}
