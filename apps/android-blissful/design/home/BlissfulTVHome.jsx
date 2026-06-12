/**
 * BlissfulTVHome — top-level screen.
 *
 * Composition (z-order back→front):
 *   Backdrop (full-bleed art of focused item)
 *   InfoPanel (featured metadata of focused item)
 *   Rows band (Continue Watching, Popular Movies, …) — vertical scroll, each a
 *     horizontal rail of focusable Tiles
 *   Sidebar (icon rail → expands to drawer on focus)
 *   Hint
 *
 * Focus model: React Native TV's native focus engine moves focus between
 * <Pressable focusable> nodes with the D-pad. We only listen to onFocus to:
 *   1) lift the focused item up to drive Backdrop + InfoPanel,
 *   2) scroll the focused row to the top of the rows band,
 *   3) expand the sidebar when one of its items is focused.
 */
import React, { useRef, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { ROWS } from './data';
import { Row } from './Row';
import { Backdrop, InfoPanel } from './Hero';
import Sidebar from './Sidebar';
import { colors, layout, ACCENT_DEFAULT } from './theme';

export default function BlissfulTVHome({ accent = ACCENT_DEFAULT }) {
  const [item, setItem] = useState(ROWS[0].items[0]);
  const [activeRow, setActiveRow] = useState(0);
  const [sidebarFocused, setSidebarFocused] = useState(false);
  const [activeNav, setActiveNav] = useState('nav-home');
  const scrollRef = useRef(null);

  const onFocusItem = useCallback((it, rowIndex) => {
    setSidebarFocused(false);
    setItem(it);
    setActiveRow(rowIndex);
    // bring the focused row to the top of the band
    scrollRef.current?.scrollTo({ y: rowIndex * layout.rowStep, animated: true });
  }, []);

  return (
    <View style={styles.root}>
      <Backdrop item={item} />
      <InfoPanel item={item} accent={accent} />

      {/* rows band */}
      <View style={styles.band} pointerEvents="box-none">
        <ScrollView
          ref={scrollRef}
          scrollEnabled={false}        // movement is driven by focus, not touch
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.bandContent}>
          {ROWS.map((row, ri) => (
            <Row key={row.title} row={row} rowIndex={ri} accent={accent}
              onFocusItem={onFocusItem} firstFocus />
          ))}
        </ScrollView>
      </View>

      <Sidebar
        expanded={sidebarFocused}
        accent={accent}
        activeNav={activeNav}
        onExpand={() => setSidebarFocused(true)}
        onCollapse={() => setSidebarFocused(false)}
        onSelectNav={(id) => { setActiveNav(id); }}
      />

      <View style={styles.hint} pointerEvents="none">
        <Text style={styles.hintTxt}>◄ ► ▲ ▼  Navigate    •    OK  Play</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  band: { position: 'absolute', left: layout.contentLeft, right: 0, top: layout.rowsTop, bottom: 0, overflow: 'hidden' },
  bandContent: { paddingTop: 52 },
  hint: { position: 'absolute', right: 56, bottom: 30, paddingHorizontal: 22, paddingVertical: 11,
    borderRadius: 999, backgroundColor: 'rgba(10,13,20,0.7)' },
  hintTxt: { color: 'rgba(255,255,255,0.62)', fontSize: 17, fontWeight: '500' },
});
