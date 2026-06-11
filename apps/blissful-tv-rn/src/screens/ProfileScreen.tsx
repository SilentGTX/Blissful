// Friend Profile — a friend's identity + what they've been watching lately.
// Port of the web app's pages/ProfilePage.tsx. Reached via "View profile" in the
// Friends accordion. Data from blissful-storage's /users/:id/profile (gated to
// accepted friends/self). Recently-watched tiles open the Detail page.
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { fetchUserProfile, normalizeStremioImage, type FriendProfileResponse, type MediaType } from '@blissful/core';
import { colors, font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useAuth } from '../context/AuthContext';
import { FriendAvatar } from '../components/FriendAvatar';
import { Img } from '../components/Img';
import { Button } from '../components/ui/Button';
import { useTvFocusable } from '../lib/useTvFocusable';
import { formatRelativeTime } from '../lib/friends';
import type { RootStackParamList } from '../navigation/types';

type ProfileRoute = RouteProp<RootStackParamList, 'Profile'>;
type Nav = StackNavigationProp<RootStackParamList, 'Profile'>;

function seasonEpisodeTag(videoId: string | null | undefined): string | null {
  if (!videoId) return null;
  const parts = videoId.split(':');
  if (parts.length < 3) return null;
  const s = Number(parts[parts.length - 2]);
  const e = Number(parts[parts.length - 1]);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  return `S${s}E${e}`;
}

export function ProfileScreen() {
  const { params } = useRoute<ProfileRoute>();
  const navigation = useNavigation<Nav>();
  const m = useMetrics();
  const { token } = useAuth();
  const [data, setData] = useState<FriendProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { navigation.goBack(); return true; });
    return () => sub.remove();
  }, [navigation]);

  useEffect(() => {
    if (!token || !params.userId) { setLoading(false); setError(!token ? 'Sign in to view profiles.' : 'No user.'); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    fetchUserProfile(token, params.userId)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load profile.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, params.userId]);

  const watchingNow = Boolean(data?.online && data.currentActivity?.name);
  const statusLine = (() => {
    if (!data) return '';
    if (data.online && data.currentActivity?.name) {
      const tag = seasonEpisodeTag(data.currentActivity.videoId);
      return `Watching ${data.currentActivity.name}${tag ? ` · ${tag}` : ''}`;
    }
    if (data.online) return 'Online';
    if (data.lastSeenAt) return `Last seen ${formatRelativeTime(data.lastSeenAt)}`;
    return 'Offline';
  })();
  const name = data?.profile.displayName ?? params.displayName ?? 'Profile';

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: m.safeX, paddingTop: m.safeY + m.s(20), paddingBottom: m.s(40) }}>
      <Button variant="glass" size="sm" icon="chevron-back" label="Back" autoFocus onPress={() => navigation.goBack()} />

      {/* Header card */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(22), borderRadius: m.s(28), backgroundColor: 'rgba(255,255,255,0.06)', padding: m.s(24), marginTop: m.s(20) }}>
        <FriendAvatar name={name} size={m.s(96)} online={Boolean(data?.online)} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: font.serif, fontSize: m.s(40), color: colors.text }}>{name}</Text>
          {data?.profile.username ? <Text numberOfLines={1} style={{ fontFamily: font.body, fontSize: m.s(18), color: 'rgba(255,255,255,0.5)', marginTop: m.s(2) }}>@{data.profile.username}</Text> : null}
          <Text numberOfLines={1} style={{ fontFamily: watchingNow ? font.bodySemi : font.body, fontSize: m.s(18), color: watchingNow ? colors.accent : 'rgba(255,255,255,0.6)', marginTop: m.s(6) }}>{statusLine}</Text>
          {data?.profile.createdAt ? <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: 'rgba(255,255,255,0.35)', marginTop: m.s(4) }}>Member since {new Date(data.profile.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text> : null}
        </View>
      </View>

      {/* Recently watched */}
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(16), letterSpacing: m.s(1), textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', marginTop: m.s(32), marginBottom: m.s(14) }}>Recently watched</Text>
      {loading ? (
        <View style={{ paddingVertical: m.s(40), alignItems: 'center' }}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : error ? (
        <Text style={{ fontFamily: font.body, fontSize: m.s(18), color: 'rgba(255,255,255,0.6)' }}>{error}</Text>
      ) : data && data.history.length > 0 ? (
        <FlatList
          horizontal
          data={data.history}
          keyExtractor={(h) => `${h.id}:${h.videoId ?? ''}`}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: m.s(20), paddingVertical: m.s(8), paddingRight: m.safeX }}
          renderItem={({ item, index }) => {
            const progress = item.duration > 0 ? Math.min(100, Math.max(0, (item.timeOffset / item.duration) * 100)) : 0;
            const tag = seasonEpisodeTag(item.videoId);
            const parts = item.videoId?.split(':') ?? [];
            const season = parts.length >= 3 ? Number(parts[parts.length - 2]) : undefined;
            const episode = parts.length >= 3 ? Number(parts[parts.length - 1]) : undefined;
            return (
              <HistoryTile
                m={m}
                poster={normalizeStremioImage(item.poster) ?? null}
                name={item.name ?? 'Untitled'}
                sub={tag ?? ((item.type === 'series' ? 'Series' : 'Movie') + (item.lastWatched ? ` · ${formatRelativeTime(item.lastWatched)}` : ''))}
                progress={progress}
                autoFocus={index === 0}
                onPress={() => navigation.navigate('Detail', { id: item.id, type: (item.type as MediaType) ?? 'movie', name: item.name ?? '', poster: normalizeStremioImage(item.poster) ?? undefined, season: Number.isFinite(season) ? season : undefined, episode: Number.isFinite(episode) ? episode : undefined })}
              />
            );
          }}
        />
      ) : (
        <Text style={{ fontFamily: font.body, fontSize: m.s(18), color: 'rgba(255,255,255,0.5)' }}>No recent activity to show.</Text>
      )}
    </ScrollView>
  );
}

function HistoryTile({ m, poster, name, sub, progress, autoFocus, onPress }: { m: ReturnType<typeof useMetrics>; poster: string | null; name: string; sub: string; progress: number; autoFocus?: boolean; onPress: () => void }) {
  const { focused, focusProps } = useTvFocusable({ autoFocus, onPress });
  const w = m.s(200);
  return (
    <Pressable {...focusProps} style={{ width: w }}>
      <View style={{ width: w, height: w * 1.5, borderRadius: m.s(14), overflow: 'hidden', backgroundColor: colors.surface, borderWidth: m.s(2), borderColor: focused ? colors.accent : 'transparent' }}>
        {poster ? <Img uri={poster} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: m.s(8) }}><Text numberOfLines={3} style={{ fontFamily: font.body, fontSize: m.s(14), color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>{name}</Text></View>
        )}
        {progress > 0 ? (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: m.s(5), backgroundColor: 'rgba(0,0,0,0.4)' }}>
            <View style={{ height: '100%', width: `${progress}%`, backgroundColor: colors.accent }} />
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={{ fontFamily: font.bodySemi, fontSize: m.s(16), color: focused ? colors.accent : colors.text, marginTop: m.s(8) }}>{name}</Text>
      <Text numberOfLines={1} style={{ fontFamily: font.body, fontSize: m.s(13), color: 'rgba(255,255,255,0.5)' }}>{sub}</Text>
    </Pressable>
  );
}

