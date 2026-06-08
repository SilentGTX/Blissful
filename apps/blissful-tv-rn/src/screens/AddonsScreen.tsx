import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { normalizeStremioImage } from '@blissful/core';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { Img } from '../components/Img';
import { NavRail } from '../components/NavRail';
import { TopBar } from '../components/TopBar';
import { markContentFocus } from '../lib/focusBus';
import { useRailOpen } from '../lib/railStore';
import { useSelfTag } from '../lib/useSelfTag';
import { useTvFocusable } from '../lib/useTvFocusable';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import {
  getAddonDisplayName,
  hydrateManifest,
  installAddon,
  loadInstalledAddonUrls,
  uninstallAddon,
  type AddonManifestLite,
  type AddonRow,
} from '../lib/addons';

type M = ReturnType<typeof useMetrics>;

// ── A focusable pill button (lavender ring on focus) ─────────────────────────
// Mirrors the web FocusableButton: white solid (primary) or white/10 (ghost),
// rounded-full, lavender focus ring. `atRowStart` traps Left so the rail opens
// when this is the row's leftmost focusable.
function FocusButton({
  label,
  onPress,
  variant = 'ghost',
  disabled,
  autoFocus,
  atRowStart,
  busy,
  m,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  autoFocus?: boolean;
  atRowStart?: boolean;
  busy?: boolean;
  m: M;
}) {
  const { focused, focusProps } = useTvFocusable({ atRowStart, autoFocus, onPress });
  const bg = variant === 'primary' ? colors.text : variant === 'danger' ? 'rgba(255,107,107,0.16)' : colors.surface10;
  const fg = variant === 'primary' ? colors.ink : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      {...focusProps}
      disabled={disabled}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: m.s(8),
        height: m.s(52),
        paddingHorizontal: m.s(26),
        borderRadius: radius.pill,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: focused ? colors.accent : 'transparent',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : null}
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(20), color: fg }}>{label}</Text>
    </Pressable>
  );
}

// ── Focusable text field (lavender ring) ─────────────────────────────────────
function Field({
  value,
  onChangeText,
  placeholder,
  iconName,
  onSubmit,
  atRowStart,
  m,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  iconName: keyof typeof Ionicons.glyphMap;
  onSubmit?: () => void;
  atRowStart?: boolean;
  m: M;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);
  const selfTag = useSelfTag(ref, Boolean(atRowStart));
  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: m.s(12),
        height: m.s(52),
        paddingHorizontal: m.s(20),
        borderRadius: radius.pill,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: focused ? colors.accent : colors.hairline,
      }}
    >
      <Ionicons name={iconName} size={m.s(24)} color={colors.textFaint} />
      <TextInput
        ref={ref}
        nextFocusLeft={selfTag}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onFocus={() => { setFocused(true); markContentFocus(Boolean(atRowStart)); }}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.textGhost}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        style={{ flex: 1, fontFamily: font.body, fontSize: m.s(20), color: colors.text, padding: 0 }}
      />
    </View>
  );
}

// ── A type/resource chip ─────────────────────────────────────────────────────
function Chip({ label, m }: { label: string; m: M }) {
  return (
    <View
      style={{
        paddingHorizontal: m.s(12),
        paddingVertical: m.s(5),
        borderRadius: radius.pill,
        backgroundColor: colors.surface08,
        borderWidth: 1,
        borderColor: colors.hairline,
      }}
    >
      <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(15), color: colors.textDim }}>{label}</Text>
    </View>
  );
}

// ── One addon card (logo + name + chips + description + Uninstall) ────────────
function AddonCard({
  row,
  busy,
  atRowStart,
  onUninstall,
  m,
}: {
  row: AddonRow;
  busy: boolean;
  atRowStart?: boolean;
  onUninstall: () => void;
  m: M;
}) {
  const name = getAddonDisplayName(row);
  const manifest: AddonManifestLite | null = row.manifest;
  const logo = normalizeStremioImage(manifest?.logo);
  // Prefer top-level content types; fall back to resource names (stream / catalog
  // / meta / subtitles) so the user can still tell what the addon provides.
  const chips = (manifest?.types?.length ? manifest.types : manifest?.resources ?? []).slice(0, 4);
  return (
    <View
      style={{
        borderRadius: m.s(18),
        borderWidth: 1,
        borderColor: colors.hairline,
        backgroundColor: 'rgba(255,255,255,0.05)',
        padding: m.s(20),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(14) }}>
        <View
          style={{
            width: m.s(48),
            height: m.s(48),
            borderRadius: m.s(12),
            overflow: 'hidden',
            backgroundColor: colors.surface10,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {logo ? (
            <Img uri={logo} style={{ width: '100%', height: '100%' }} contentFit="contain" />
          ) : (
            <Ionicons name="cube-outline" size={m.s(26)} color={colors.textFaint} />
          )}
        </View>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.bodySemi, fontSize: m.s(22), color: colors.text }}>
          {name}
        </Text>
      </View>

      {chips.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.s(8), marginTop: m.s(12) }}>
          {chips.map((c) => (
            <Chip key={c} label={c} m={m} />
          ))}
        </View>
      ) : null}

      {manifest?.description ? (
        <Text numberOfLines={2} style={{ fontFamily: font.body, fontSize: m.s(17), color: colors.textFaint, marginTop: m.s(12), lineHeight: m.s(23) }}>
          {manifest.description}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', marginTop: m.s(18) }}>
        <FocusButton label="Uninstall" variant="danger" busy={busy} disabled={busy} atRowStart={atRowStart} onPress={onUninstall} m={m} />
      </View>
    </View>
  );
}

export function AddonsScreen() {
  const m = useMetrics();
  const railOpen = useRailOpen();
  const { token } = useAuth();
  const toast = useToast();

  const [rows, setRows] = useState<AddonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);

  // Load the installed list, then hydrate each manifest progressively so names /
  // logos / chips fill in as they arrive (no all-or-nothing wait).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadInstalledAddonUrls(token)
      .then((urls) => {
        if (cancelled) return;
        setRows(urls.map((transportUrl) => ({ transportUrl, manifest: null })));
        setLoading(false);
        for (const transportUrl of urls) {
          hydrateManifest(transportUrl).then((manifest) => {
            if (cancelled || !manifest) return;
            setRows((prev) => prev.map((r) => (r.transportUrl === transportUrl ? { ...r, manifest } : r)));
          });
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onAdd = useCallback(async () => {
    if (adding) return;
    setAdding(true);
    try {
      const row = await installAddon(token, draftUrl, rows.map((r) => r.transportUrl));
      setRows((prev) => [row, ...prev.filter((r) => r.transportUrl !== row.transportUrl)]);
      setDraftUrl('');
      toast.show(`Added ${getAddonDisplayName(row)}`);
    } catch (err: unknown) {
      toast.show(err instanceof Error ? err.message : 'Failed to add addon.');
    } finally {
      setAdding(false);
    }
  }, [adding, draftUrl, rows, token, toast]);

  const onUninstall = useCallback(
    async (transportUrl: string) => {
      const name = getAddonDisplayName({ transportUrl, manifest: undefined });
      setBusyUrl(transportUrl);
      try {
        await uninstallAddon(token, transportUrl, rows.map((r) => r.transportUrl));
        setRows((prev) => prev.filter((r) => r.transportUrl !== transportUrl));
        toast.show(`Removed ${name}`);
      } catch (err: unknown) {
        toast.show(err instanceof Error ? err.message : 'Failed to remove addon.');
      } finally {
        setBusyUrl(null);
      }
    },
    [rows, token, toast],
  );

  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => {
        const name = getAddonDisplayName(r).toLowerCase();
        const desc = (r.manifest?.description ?? '').toLowerCase();
        return name.includes(q) || desc.includes(q);
      })
    : rows;

  // 2-column grid (md:grid-cols-2 on the web). Row-major so the leftmost card in
  // each row (even index) traps Left for the rail-open.
  const pairs: AddonRow[][] = [];
  for (let i = 0; i < filtered.length; i += 2) pairs.push(filtered.slice(i, i + 2));

  return (
    <View style={styles.root}>
      <NavRail active="Addons" />
      <TopBar />
      <ScrollView
        // One flip (not per-card) so an open rail traps focus instantly.
        isTVSelectable={!railOpen}
        style={{ position: 'absolute', left: m.contentLeft, top: m.contentTop, right: 0, bottom: 0 }}
        contentContainerStyle={{ paddingRight: m.safeX, paddingBottom: m.s(60), paddingLeft: m.s(20) }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            borderRadius: radius.panel,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.hairline,
            padding: m.s(28),
          }}
        >
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: m.s(20) }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: font.serif, fontSize: m.s(34), color: colors.text }}>Addons</Text>
              <Text style={{ fontFamily: font.body, fontSize: m.s(19), color: colors.textFaint, marginTop: m.s(4) }}>
                Manage your installed addons.
              </Text>
            </View>
          </View>

          {/* Add-by-URL row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(14), marginTop: m.s(22) }}>
            <Field
              value={draftUrl}
              onChangeText={setDraftUrl}
              placeholder="Addon manifest URL (https://.../manifest.json)"
              iconName="link-outline"
              onSubmit={onAdd}
              atRowStart
              m={m}
            />
            <FocusButton label="Add addon" variant="primary" busy={adding} disabled={adding} autoFocus onPress={onAdd} m={m} />
          </View>

          {/* Search filter */}
          <View style={{ flexDirection: 'row', marginTop: m.s(14) }}>
            <Field
              value={query}
              onChangeText={setQuery}
              placeholder="Search addons"
              iconName="search"
              atRowStart
              m={m}
            />
          </View>

          {/* List */}
          <View style={{ marginTop: m.s(24), gap: m.s(14) }}>
            {loading ? (
              <View style={{ height: m.height - m.contentTop - m.s(220), alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={colors.accent} size="large" />
              </View>
            ) : filtered.length === 0 ? (
              <Text style={{ fontFamily: font.body, fontSize: m.s(19), color: colors.textFaint }}>No addons found.</Text>
            ) : (
              pairs.map((pair, rowIdx) => (
                <View key={rowIdx} style={{ flexDirection: 'row', gap: m.s(14) }}>
                  {pair.map((row, colIdx) => (
                    <View key={row.transportUrl} style={{ flex: 1 }}>
                      <AddonCard
                        row={row}
                        busy={busyUrl === row.transportUrl}
                        atRowStart={colIdx === 0}
                        onUninstall={() => onUninstall(row.transportUrl)}
                        m={m}
                      />
                    </View>
                  ))}
                  {/* Keep a lone card half-width like the web grid. */}
                  {pair.length === 1 ? <View style={{ flex: 1 }} /> : null}
                </View>
              ))
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
});
