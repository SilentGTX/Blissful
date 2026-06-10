/**
 * Sidebar — collapses to an icon rail, expands to a full drawer when any of its
 * items receives focus. Holds the main nav, the Friends entry, and the Friends
 * panel (Search people, Friends/Requests tabs, list, friend requests).
 *
 * TV FOCUS: expansion is driven by focus, not hover. When focus leaves the
 * sidebar (D-pad right onto content), `expanded` goes false. Wrap the sidebar in a
 * <TVFocusGuideView> so the OS keeps focus trappable while it's open.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Icon } from './Icon';
import { colors, layout, rgba } from './theme';
import { NAV, FRIENDS, REQUESTS } from './data';

function NavItem({ item, active, expanded, accent, onFocus, onSelect }) {
  return (
    <Pressable focusable onFocus={onFocus} onPress={onSelect}
      style={({ focused }) => [
        styles.navItem,
        active && !focused && { backgroundColor: rgba(accent, 0.14), borderColor: rgba(accent, 0.5), borderWidth: 1.5 },
        focused && { backgroundColor: accent },
      ]}>
      {({ focused }) => {
        const color = focused ? colors.ink : active ? accent : colors.textDim;
        return (
          <>
            <Icon name={item.icon} size={26} color={color} />
            {expanded && <Text style={[styles.navLabel, { color: focused ? colors.ink : '#fff' }]}>{item.label}</Text>}
          </>
        );
      }}
    </Pressable>
  );
}

function FriendRow({ f }) {
  return (
    <Pressable focusable onPress={() => {}}
      style={({ focused }) => [styles.friendRow, focused && { backgroundColor: '#8aa0ff' }]}>
      {({ focused }) => (
        <>
          <View style={[styles.avatar, focused && { backgroundColor: 'rgba(0,0,0,0.2)' }]}>
            <Text style={[styles.avatarTxt, focused && { color: colors.ink }]}>{f.name[0].toUpperCase()}</Text>
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text style={[styles.friendName, focused && { color: colors.ink }]}>{f.name}</Text>
            <Text style={[styles.friendSeen, focused && { color: 'rgba(0,0,0,0.6)' }]}>{f.seen}</Text>
          </View>
        </>
      )}
    </Pressable>
  );
}

function ReqBtn({ accept, accent }) {
  return (
    <Pressable focusable onPress={() => {}}
      style={({ focused }) => [
        styles.reqBtn,
        { backgroundColor: accept ? accent : 'rgba(255,255,255,0.1)' },
        focused && { transform: [{ scale: 1.08 }], borderColor: accent, borderWidth: 3 },
      ]}>
      <Icon name={accept ? 'check' : 'close'} size={22} color={accept ? colors.ink : '#fff'} strokeWidth={2.6} />
    </Pressable>
  );
}

function RequestRow({ r, accent }) {
  return (
    <View style={styles.requestRow}>
      <View style={styles.avatar}><Text style={styles.avatarTxt}>{r.name[0].toUpperCase()}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.friendName}>{r.name}</Text>
        <Text style={styles.friendSeen}>{r.msg}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <ReqBtn accept accent={accent} />
        <ReqBtn accent={accent} />
      </View>
    </View>
  );
}

function Tab({ label, isActive, accent }) {
  return (
    <Pressable focusable onPress={() => {}}
      style={({ focused }) => [
        styles.tab,
        isActive && !focused && { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.16)', borderWidth: 1.5 },
        focused && { backgroundColor: accent },
      ]}>
      {({ focused }) => (
        <Text style={[styles.tabText, { color: focused ? colors.ink : isActive ? '#fff' : 'rgba(255,255,255,0.5)' }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export default function Sidebar({ expanded, accent, activeNav, onExpand, onCollapse, onSelectNav }) {
  const [tab, setTab] = useState('friends');
  const width = expanded ? layout.drawerWidth : layout.railWidth;

  return (
    <View
      onFocus={onExpand}
      style={[styles.aside, { width, backgroundColor: expanded ? colors.panel : 'transparent',
        borderRightWidth: expanded ? 1 : 0, borderRightColor: colors.panelEdge }]}>
      {/* brand */}
      <View style={styles.brand}>
        <View style={styles.logo} />
        {expanded && <Text style={styles.brandText}>Blissful</Text>}
      </View>

      {/* search at top */}
      <Pressable focusable onFocus={() => onSelectNav('nav-search')}
        style={({ focused }) => [styles.search, focused && { backgroundColor: accent },
          !focused && expanded && { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1.5 }]}>
        {({ focused }) => (
          <>
            <Icon name="search" size={26} color={focused ? colors.ink : 'rgba(255,255,255,0.55)'} />
            {expanded && <Text style={[styles.navLabel, { color: focused ? colors.ink : 'rgba(255,255,255,0.55)' }]}>Search</Text>}
          </>
        )}
      </Pressable>

      {/* main nav */}
      <View style={{ gap: 4 }}>
        {NAV.filter((n) => n.id !== 'nav-search').map((it) => (
          <NavItem key={it.id} item={it} accent={accent} expanded={expanded}
            active={activeNav === it.id}
            onFocus={() => {}} onSelect={() => onSelectNav(it.id)} />
        ))}
      </View>

      <View style={styles.hairline} />

      {/* friends entry */}
      <Pressable focusable onPress={() => {}}
        style={({ focused }) => [styles.navItem, focused && { backgroundColor: accent }]}>
        {({ focused }) => (
          <>
            <View>
              <Icon name="friends" size={26} color={focused ? colors.ink : colors.textDim} />
              <View style={[styles.badge, { backgroundColor: focused ? colors.ink : accent }]}>
                <Text style={[styles.badgeTxt, { color: focused ? '#fff' : colors.ink }]}>1</Text>
              </View>
            </View>
            {expanded && <Text style={[styles.navLabel, { color: focused ? colors.ink : '#fff' }]}>Friends</Text>}
          </>
        )}
      </Pressable>

      {/* friends panel */}
      {expanded && (
        <View style={styles.friendsPanel}>
          <Pressable focusable onPress={() => {}}
            style={({ focused }) => [styles.searchPeople, focused && { backgroundColor: accent }]}>
            {({ focused }) => (
              <>
                <Icon name="search" size={22} color={focused ? colors.ink : 'rgba(255,255,255,0.5)'} />
                <Text style={[styles.searchPeopleTxt, { color: focused ? colors.ink : 'rgba(255,255,255,0.5)' }]}>Search people…</Text>
              </>
            )}
          </Pressable>
          <View style={styles.tabs}>
            <Pressable focusable onPress={() => setTab('friends')} style={{ flex: 1 }}>
              {() => <Tab label="Friends 6" isActive={tab === 'friends'} accent={accent} />}
            </Pressable>
            <Pressable focusable onPress={() => setTab('requests')} style={{ flex: 1 }}>
              {() => <Tab label="Requests 1" isActive={tab === 'requests'} accent={accent} />}
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 6 }} showsVerticalScrollIndicator={false}>
            {tab === 'friends'
              ? FRIENDS.map((f) => <FriendRow key={f.id} f={f} />)
              : REQUESTS.map((r) => <RequestRow key={r.id} r={r} accent={accent} />)}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  aside: { position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 50, overflow: 'hidden' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 94, paddingHorizontal: 28 },
  logo: { width: 44, height: 44, borderRadius: 13, backgroundColor: '#2a7d5a' },
  brandText: { fontFamily: 'Spectral-SemiBold', fontSize: 30, color: '#fff' },

  search: { flexDirection: 'row', alignItems: 'center', gap: 18, height: 54, marginHorizontal: 22, marginBottom: 6, paddingHorizontal: 22, borderRadius: 16 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 18, height: 56, marginHorizontal: 22, paddingHorizontal: 22, borderRadius: 16 },
  navLabel: { fontSize: 23, fontWeight: '600', flexShrink: 1 },

  hairline: { height: 1, backgroundColor: colors.hairline, marginVertical: 12, marginHorizontal: 28 },
  badge: { position: 'absolute', top: -6, right: -8, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  badgeTxt: { fontSize: 12, fontWeight: '800' },

  friendsPanel: { flex: 1, paddingHorizontal: 24, paddingTop: 4, paddingBottom: 18 },
  searchPeople: { flexDirection: 'row', alignItems: 'center', gap: 13, height: 50, paddingHorizontal: 18, borderRadius: 12, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.06)' },
  searchPeopleTxt: { fontSize: 19 },
  tabs: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  tab: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.04)' },
  tabText: { fontSize: 19, fontWeight: '600' },

  friendRow: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 64, paddingHorizontal: 18, borderRadius: 14 },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 84, paddingHorizontal: 18, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.04)' },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.09)' },
  avatarTxt: { color: '#fff', fontSize: 19, fontWeight: '700' },
  friendName: { color: '#fff', fontSize: 20, fontWeight: '600' },
  friendSeen: { color: 'rgba(255,255,255,0.45)', fontSize: 16 },
  reqBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
