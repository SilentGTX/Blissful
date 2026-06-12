// In-player Watch Party drawer — the TV port of the desktop WatchParty/
// WatchPartyDrawer. Slides in from the right like the Settings/Episodes drawers,
// native D-pad focus + FocusTrap. Auto-picks the view from `roomCode`:
//   roomCode == null + tab 'open'  -> Open Room (create public / password)
//   roomCode == null + tab 'join'  -> Join Room (code + password step)
//   roomCode != null               -> Active Room (People / Chat + room code + leave)
//
// TV adaptations of the desktop: no clipboard — the room code is shown LARGE and
// the invite link as selectable text; every control is a real focusable Pressable;
// text entry (code / password / chat) opens the Android TV IME via an inner
// TextInput focused on OK. Control is democratised (no guest lock), matching the
// desktop — only a Host badge distinguishes the host.

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInput as RNTextInput } from 'react-native';
import { colors, font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { FocusTrap } from '../FocusTrap';
import {
  avatarBg,
  getWatchPartyRoom,
  initials,
  isValidRoomCode,
  formatRoomCodeInput,
  messageKeyFor,
  ROOM_CODE_LENGTH,
  stashWatchPartyPassword,
  verifyWatchPartyPassword,
  type ReactionMap,
  type WatchPartyChatMessage,
  type WatchPartyParticipant,
  type WatchPartyRoomInfo,
} from '../../lib/watchParty';

type M = ReturnType<typeof useMetrics>;
const REACT_EMOJIS = ['👍', '😂', '😮', '❤️', '🔥', '👀'];

export type WatchPartyDrawerProps = {
  onClose: () => void;
  tab: 'open' | 'join';
  onTabChange: (t: 'open' | 'join') => void;
  // Active room
  roomCode: string | null;
  connected: boolean;
  selfUserId: string | null;
  hostUserId: string | null;
  participants: WatchPartyParticipant[];
  chat: WatchPartyChatMessage[];
  reactions: ReactionMap;
  typingNames: string[];
  hasPassword: boolean;
  error: string | null;
  inviteLink: string;
  sendChat: (text: string) => void;
  sendTyping: () => void;
  toggleReaction: (messageKey: string, emoji: string) => void;
  onLeave: () => void;
  // Create
  canCreate: boolean;
  creatingRoom: boolean;
  onCreateRoom: (password: string | null) => void;
  // Join
  onNavigateToRoom: (room: WatchPartyRoomInfo) => void;
};

export function WatchPartyDrawer(props: WatchPartyDrawerProps) {
  const m = useMetrics();
  const W = m.s(440);
  const offX = W + m.s(32);
  const tx = useRef(new Animated.Value(offX)).current;
  const dim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(tx, { toValue: 0, stiffness: 280, damping: 32, mass: 0.85, useNativeDriver: true }).start();
    Animated.timing(dim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [tx, dim]);

  const inRoom = props.roomCode != null;
  // Active room People/Chat sub-tab.
  const [activeTab, setActiveTab] = useState<'people' | 'chat'>('people');

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { opacity: dim, zIndex: 200, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'flex-end', paddingTop: m.s(96), paddingBottom: m.s(96), paddingHorizontal: m.s(32) },
      ]}
    >
      <Animated.View style={{ transform: [{ translateX: tx }], width: W, maxHeight: '100%' }}>
        <FocusTrap style={{ gap: m.s(12) }}>
          {/* Header: tab pill + close */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: m.s(8) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(4), borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)', padding: m.s(4) }}>
              {inRoom ? (
                <>
                  <Pill m={m} label="People" active={activeTab === 'people'} onPress={() => setActiveTab('people')} />
                  <Pill m={m} label="Chat" active={activeTab === 'chat'} onPress={() => setActiveTab('chat')} />
                </>
              ) : (
                <>
                  <Pill m={m} label="Open Room" active={props.tab === 'open'} onPress={() => props.onTabChange('open')} />
                  <Pill m={m} label="Join Room" active={props.tab === 'join'} onPress={() => props.onTabChange('join')} />
                </>
              )}
            </View>
            <RoundBtn m={m} onPress={props.onClose}><Ionicons name="close" size={m.s(18)} color="#fff" /></RoundBtn>
          </View>

          {/* Body card */}
          <View style={{ flexShrink: 1, overflow: 'hidden', borderRadius: m.s(24), borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(16,17,22,0.97)' }}>
            {!inRoom && props.tab === 'open' ? (
              <OpenRoomView m={m} canCreate={props.canCreate} creating={props.creatingRoom} onCreate={props.onCreateRoom} />
            ) : null}
            {!inRoom && props.tab === 'join' ? (
              <JoinRoomView m={m} onNavigateToRoom={props.onNavigateToRoom} />
            ) : null}
            {inRoom ? (
              <ActiveRoomView m={m} activeTab={activeTab} {...props} />
            ) : null}
          </View>
        </FocusTrap>
      </Animated.View>
    </Animated.View>
  );
}

// ── Open Room (create) ────────────────────────────────────────────────────────
function OpenRoomView({ m, canCreate, creating, onCreate }: { m: M; canCreate: boolean; creating: boolean; onCreate: (pw: string | null) => void }) {
  const [mode, setMode] = useState<'public' | 'password'>('public');
  const [password, setPassword] = useState('');
  const valid = mode === 'public' || password.trim().length > 0;
  return (
    <ScrollView contentContainerStyle={{ padding: m.s(16), gap: m.s(10) }}>
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(18), color: '#fff' }}>Open a watch party</Text>
      <Text style={{ fontFamily: font.body, fontSize: m.s(14), color: 'rgba(255,255,255,0.55)' }}>Public lets anyone with the code join. Password-protected only lets people you share the password with in.</Text>
      <ModeCard m={m} emoji="🎬" title="Public room" sub="Anyone with the code or invite link can join." active={mode === 'public'} autoFocus onPress={() => setMode('public')} />
      <ModeCard m={m} emoji="🔒" title="Password-protected" sub="Set a password and share it with who you invite." active={mode === 'password'} onPress={() => setMode('password')} />
      {mode === 'password' ? (
        <DrawerInput m={m} value={password} onChange={setPassword} placeholder="Room password" />
      ) : null}
      {!canCreate ? <Text style={{ fontFamily: font.body, fontSize: m.s(13), color: 'rgba(255,255,255,0.55)' }}>Sign in and start playing something to open a room.</Text> : null}
      <SolidBtn m={m} label={creating ? 'Starting...' : mode === 'password' ? 'Create password room' : 'Create public room'} disabled={!canCreate || creating || !valid} onPress={() => onCreate(mode === 'password' ? password.trim() : null)} />
    </ScrollView>
  );
}

// ── Join Room (code -> optional password -> navigate) ──────────────────────────
function JoinRoomView({ m, onNavigateToRoom }: { m: M; onNavigateToRoom: (room: WatchPartyRoomInfo) => void }) {
  const [step, setStep] = useState<{ kind: 'code' } | { kind: 'password'; room: WatchPartyRoomInfo }>({ kind: 'code' });
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitCode = async () => {
    if (!isValidRoomCode(code) || busy) return;
    setBusy(true); setError(null);
    try {
      const room = await getWatchPartyRoom(code);
      if (!room) { setError('No room with that code.'); return; }
      if (room.hasPassword) setStep({ kind: 'password', room });
      else onNavigateToRoom(room);
    } catch { setError('Lookup failed. Try again.'); } finally { setBusy(false); }
  };
  const submitPassword = async () => {
    if (step.kind !== 'password' || busy) return;
    setBusy(true); setError(null);
    try {
      const ok = await verifyWatchPartyPassword(step.room.code, password);
      if (!ok) { setError('Wrong password.'); return; }
      stashWatchPartyPassword(step.room.code, password);
      onNavigateToRoom(step.room);
    } catch { setError('Could not verify. Try again.'); } finally { setBusy(false); }
  };

  if (step.kind === 'password') {
    return (
      <ScrollView contentContainerStyle={{ padding: m.s(16), gap: m.s(10) }}>
        <BackRow m={m} label="Back" onPress={() => { setStep({ kind: 'code' }); setError(null); }} />
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(16), color: '#fff' }}>Room {step.room.code.toUpperCase()} is password-protected.</Text>
        <DrawerInput m={m} value={password} onChange={setPassword} placeholder="Room password" autoFocus />
        {error ? <Text style={{ fontFamily: font.body, fontSize: m.s(13), color: '#f87171' }}>{error}</Text> : null}
        <SolidBtn m={m} label={busy ? 'Verifying...' : 'Join'} disabled={busy || !password.trim()} onPress={submitPassword} />
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={{ padding: m.s(16), gap: m.s(10) }}>
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(18), color: '#fff' }}>Join a watch party</Text>
      <Text style={{ fontFamily: font.body, fontSize: m.s(14), color: 'rgba(255,255,255,0.55)' }}>Enter the code your friend shared.</Text>
      <DrawerInput m={m} value={code} onChange={(t) => setCode(formatRoomCodeInput(t))} placeholder="xxx-yyy" autoFocus maxLength={ROOM_CODE_LENGTH} center mono onSubmit={submitCode} />
      {error ? <Text style={{ fontFamily: font.body, fontSize: m.s(13), color: '#f87171' }}>{error}</Text> : null}
      <SolidBtn m={m} label={busy ? 'Looking up...' : 'Continue'} disabled={busy || !isValidRoomCode(code)} onPress={submitCode} />
    </ScrollView>
  );
}

// ── Active Room ─────────────────────────────────────────────────────────────
function ActiveRoomView({ m, activeTab, ...p }: WatchPartyDrawerProps & { m: M; activeTab: 'people' | 'chat' }) {
  return (
    <View style={{ maxHeight: '100%' }}>
      {activeTab === 'people' ? (
        <PeopleTab m={m} {...p} />
      ) : (
        <ChatTab m={m} {...p} />
      )}
    </View>
  );
}

function PeopleTab({ m, ...p }: WatchPartyDrawerProps & { m: M }) {
  return (
    <View>
      <ScrollView contentContainerStyle={{ padding: m.s(14), gap: m.s(6) }} style={{ maxHeight: m.s(420) }}>
        {p.participants.map((part) => {
          const isSelf = part.userId === p.selfUserId;
          const isHost = part.userId === p.hostUserId;
          return (
            <View key={part.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(10), borderRadius: m.s(12), paddingHorizontal: m.s(12), paddingVertical: m.s(10), backgroundColor: 'rgba(255,255,255,0.04)' }}>
              <View style={{ width: m.s(34), height: m.s(34), borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: avatarBg(part.userId) }}>
                <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(13), color: '#fff' }}>{initials(part.displayName)}</Text>
              </View>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.bodyMed, fontSize: m.s(16), color: '#fff' }}>
                {part.displayName}{isSelf ? <Text style={{ color: 'rgba(255,255,255,0.4)' }}>  (you)</Text> : null}
              </Text>
              {isHost ? (
                <View style={{ borderRadius: 999, backgroundColor: 'rgba(149,162,255,0.2)', paddingHorizontal: m.s(10), paddingVertical: m.s(3) }}>
                  <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(11), letterSpacing: m.s(0.5), color: colors.accent, textTransform: 'uppercase' }}>Host</Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      <RoomFooter m={m} {...p} />
    </View>
  );
}

function ChatTab({ m, ...p }: WatchPartyDrawerProps & { m: M }) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  return (
    <View>
      <ScrollView ref={scrollRef} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })} contentContainerStyle={{ padding: m.s(14), gap: m.s(8) }} style={{ height: m.s(380) }}>
        {p.chat.length === 0 ? (
          <Text style={{ fontFamily: font.body, fontSize: m.s(14), color: 'rgba(255,255,255,0.45)', textAlign: 'center', paddingVertical: m.s(40) }}>No messages yet. Say hi.</Text>
        ) : (
          p.chat.map((msg) => {
            const mine = msg.from.userId === p.selfUserId;
            const key = messageKeyFor(msg);
            const reacts = p.reactions[key] ?? {};
            return (
              <View key={key} style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: m.s(3) }}>
                <Text style={{ fontFamily: font.body, fontSize: m.s(11), color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: m.s(0.5) }}>{mine ? 'You' : msg.from.displayName}</Text>
                <ChatBubble m={m} mine={mine} text={msg.text} onReact={(emoji) => p.toggleReaction(key, emoji)} />
                {Object.keys(reacts).length > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.s(4) }}>
                    {Object.entries(reacts).map(([emoji, users]) => (
                      <View key={emoji} style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(3), borderRadius: 999, paddingHorizontal: m.s(7), paddingVertical: m.s(2), backgroundColor: users.includes(p.selfUserId ?? '') ? 'rgba(149,162,255,0.25)' : 'rgba(255,255,255,0.08)' }}>
                        <Text style={{ fontSize: m.s(12) }}>{emoji}</Text>
                        <Text style={{ fontFamily: font.body, fontSize: m.s(11), color: 'rgba(255,255,255,0.8)' }}>{users.length}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>
      {p.typingNames.length > 0 ? (
        <Text style={{ fontFamily: font.body, fontSize: m.s(12), color: 'rgba(255,255,255,0.45)', paddingHorizontal: m.s(14), paddingBottom: m.s(4) }}>
          {p.typingNames.length === 1 ? `${p.typingNames[0]} is typing...` : `${p.typingNames.length} people are typing...`}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8), borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', padding: m.s(10) }}>
        <View style={{ flex: 1 }}>
          <DrawerInput m={m} value={draft} onChange={(t) => { setDraft(t); if (t.trim()) p.sendTyping(); }} placeholder="Type a message..." maxLength={500} onSubmit={() => { if (draft.trim()) { p.sendChat(draft); setDraft(''); } }} />
        </View>
        <SmallBtn m={m} label="Send" disabled={!draft.trim()} onPress={() => { if (draft.trim()) { p.sendChat(draft); setDraft(''); } }} />
      </View>
    </View>
  );
}

function ChatBubble({ m, mine, text, onReact }: { m: M; mine: boolean; text: string; onReact: (emoji: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <Pressable
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ maxWidth: m.s(300), borderRadius: m.s(14), paddingHorizontal: m.s(12), paddingVertical: m.s(8), backgroundColor: mine ? 'rgba(149,162,255,0.85)' : 'rgba(255,255,255,0.1)', borderWidth: m.s(2), borderColor: focused ? colors.accent : 'transparent' }}
      >
        <Text style={{ fontFamily: font.body, fontSize: m.s(15), color: mine ? '#0a0c12' : '#fff' }}>{text}</Text>
      </Pressable>
      {focused ? (
        <View style={{ flexDirection: 'row', gap: m.s(4), marginTop: m.s(4) }}>
          {REACT_EMOJIS.map((e) => (
            <Pressable key={e} onPress={() => onReact(e)} style={({ focused: f }) => ({ borderRadius: 999, paddingHorizontal: m.s(6), paddingVertical: m.s(2), backgroundColor: f ? 'rgba(149,162,255,0.3)' : 'rgba(255,255,255,0.08)', borderWidth: m.s(1.5), borderColor: f ? colors.accent : 'transparent' })}>
              <Text style={{ fontSize: m.s(15) }}>{e}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function RoomFooter({ m, ...p }: WatchPartyDrawerProps & { m: M }) {
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', padding: m.s(14), gap: m.s(8) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(11), letterSpacing: m.s(1), textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' }}>Room code</Text>
        <Text style={{ fontFamily: font.body, fontSize: m.s(12), color: p.error ? '#f87171' : 'rgba(255,255,255,0.55)' }}>{p.error ? p.error : p.connected ? 'Connected' : 'Connecting...'}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(30), letterSpacing: m.s(3), textTransform: 'uppercase', color: colors.accent }}>{p.roomCode}</Text>
        {p.hasPassword ? <Ionicons name="lock-closed" size={m.s(18)} color="rgba(255,255,255,0.7)" /> : null}
      </View>
      <Text numberOfLines={1} style={{ fontFamily: font.body, fontSize: m.s(13), color: 'rgba(255,255,255,0.5)' }}>{p.inviteLink}</Text>
      <Pressable onPress={p.onLeave} style={({ focused }) => ({ marginTop: m.s(4), alignItems: 'center', borderRadius: 999, paddingVertical: m.s(10), backgroundColor: focused ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.15)', borderWidth: m.s(2), borderColor: focused ? '#ef4444' : 'rgba(239,68,68,0.3)' })}>
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(14), color: '#fca5a5' }}>Leave party</Text>
      </Pressable>
    </View>
  );
}

// ── Focusable primitives ──────────────────────────────────────────────────────
function Pill({ m, label, active, onPress }: { m: M; label: string; active: boolean; onPress: () => void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable onFocus={() => setF(true)} onBlur={() => setF(false)} onPress={onPress} style={{ borderRadius: 999, paddingHorizontal: m.s(14), paddingVertical: m.s(6), backgroundColor: f ? 'rgba(255,255,255,0.12)' : active ? 'rgba(255,255,255,0.15)' : 'transparent', borderWidth: m.s(2), borderColor: f ? colors.accent : 'transparent' }}>
      <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(12), color: active ? '#fff' : 'rgba(255,255,255,0.6)' }}>{label}</Text>
    </Pressable>
  );
}

function RoundBtn({ m, onPress, children }: { m: M; onPress: () => void; children: React.ReactNode }) {
  const [f, setF] = useState(false);
  return (
    <Pressable onFocus={() => setF(true)} onBlur={() => setF(false)} onPress={onPress} style={{ width: m.s(36), height: m.s(36), borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: f ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.6)', borderWidth: m.s(2), borderColor: f ? colors.accent : 'transparent' }}>
      {children}
    </Pressable>
  );
}

function ModeCard({ m, emoji, title, sub, active, autoFocus, onPress }: { m: M; emoji: string; title: string; sub: string; active: boolean; autoFocus?: boolean; onPress: () => void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable hasTVPreferredFocus={autoFocus} onFocus={() => setF(true)} onBlur={() => setF(false)} onPress={onPress}
      style={{ flexDirection: 'row', gap: m.s(12), borderRadius: m.s(16), paddingHorizontal: m.s(14), paddingVertical: m.s(12), backgroundColor: active ? 'rgba(149,162,255,0.1)' : 'rgba(255,255,255,0.04)', borderWidth: m.s(2), borderColor: f ? colors.accent : active ? 'rgba(149,162,255,0.5)' : 'transparent' }}>
      <Text style={{ fontSize: m.s(20) }}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(15), color: '#fff' }}>{title}</Text>
        <Text style={{ fontFamily: font.body, fontSize: m.s(13), color: 'rgba(255,255,255,0.55)' }}>{sub}</Text>
      </View>
    </Pressable>
  );
}

function DrawerInput({ m, value, onChange, placeholder, autoFocus, maxLength, center, mono, onSubmit }: { m: M; value: string; onChange: (t: string) => void; placeholder?: string; autoFocus?: boolean; maxLength?: number; center?: boolean; mono?: boolean; onSubmit?: () => void }) {
  const [f, setF] = useState(false);
  const ref = useRef<RNTextInput | null>(null);
  return (
    <Pressable hasTVPreferredFocus={autoFocus} onFocus={() => setF(true)} onBlur={() => setF(false)} onPress={() => ref.current?.focus()}
      style={{ borderRadius: m.s(12), borderWidth: m.s(2), borderColor: f ? colors.accent : 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: m.s(14), minHeight: m.s(48), justifyContent: 'center' }}>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChange}
        onFocus={() => setF(true)}
        onBlur={() => setF(false)}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.35)"
        maxLength={maxLength}
        autoCapitalize="none"
        autoCorrect={false}
        cursorColor={colors.accent}
        selectionColor={colors.accent}
        style={{ fontFamily: mono ? font.body : font.body, fontSize: m.s(mono ? 22 : 16), letterSpacing: mono ? m.s(6) : 0, textAlign: center ? 'center' : 'left', color: '#fff', paddingVertical: m.s(10) }}
      />
    </Pressable>
  );
}

function SolidBtn({ m, label, disabled, onPress }: { m: M; label: string; disabled?: boolean; onPress: () => void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable disabled={disabled} onFocus={() => setF(true)} onBlur={() => setF(false)} onPress={onPress}
      style={{ marginTop: m.s(4), alignItems: 'center', borderRadius: 999, paddingVertical: m.s(12), backgroundColor: disabled ? 'rgba(255,255,255,0.15)' : f ? '#e6e9ff' : '#fff', opacity: disabled ? 0.5 : 1, borderWidth: m.s(2), borderColor: f ? colors.accent : 'transparent' }}>
      {label.endsWith('...') ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}><ActivityIndicator size="small" color="#000" /><Text style={{ fontFamily: font.bodySemi, fontSize: m.s(14), color: '#000' }}>{label}</Text></View>
      ) : (
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(14), color: '#000' }}>{label}</Text>
      )}
    </Pressable>
  );
}

function SmallBtn({ m, label, disabled, onPress }: { m: M; label: string; disabled?: boolean; onPress: () => void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable disabled={disabled} onFocus={() => setF(true)} onBlur={() => setF(false)} onPress={onPress}
      style={{ borderRadius: 999, paddingHorizontal: m.s(14), paddingVertical: m.s(9), backgroundColor: disabled ? 'rgba(149,162,255,0.3)' : colors.accent, opacity: disabled ? 0.5 : 1, borderWidth: m.s(2), borderColor: f ? '#fff' : 'transparent' }}>
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(13), color: '#0a0c12' }}>{label}</Text>
    </Pressable>
  );
}

function BackRow({ m, label, onPress }: { m: M; label: string; onPress: () => void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable hasTVPreferredFocus onFocus={() => setF(true)} onBlur={() => setF(false)} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(6), alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: m.s(10), paddingVertical: m.s(6), backgroundColor: f ? 'rgba(255,255,255,0.12)' : 'transparent', borderWidth: m.s(2), borderColor: f ? colors.accent : 'transparent' }}>
      <Ionicons name="chevron-back" size={m.s(16)} color="rgba(255,255,255,0.8)" />
      <Text style={{ fontFamily: font.body, fontSize: m.s(14), color: 'rgba(255,255,255,0.8)' }}>{label}</Text>
    </Pressable>
  );
}
