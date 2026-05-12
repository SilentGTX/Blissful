// Phase 0b spike route — proves the real React build can render transparently
// over libmpv in the native Rust shell. NOT a real Blissful page. Delete this
// file (and its route registration in App.tsx) once Phase 1 is underway.
//
// Layout intent (matches apps/blissful-shell/src/phase_0a_spike.html):
//   - 60px top strip: dark translucent — back-button placeholder
//   - middle: explicitly transparent + pointer-events:none so the entire
//     hover/click area passes through to libmpv via the parent HWND
//   - 80px bottom strip: dark translucent — controls placeholder + one button
//
// CSS notes: Tailwind's bg-* classes would ALSO produce opaque pixels we
// can't see through, so this component uses inline `background` styles
// to make transparency unambiguous in the test.

import { useEffect, useState, type CSSProperties } from 'react';
import { desktop, isNativeShell } from '../lib/desktop';

function fmt(v: unknown): string {
  if (typeof v === 'number') return v.toFixed(2);
  if (v == null) return '?';
  return String(v);
}

const buttonStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.15)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  color: 'white',
  padding: '8px 16px',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
};

export default function PlayerSpikePage() {
  const [appVersion, setAppVersion] = useState<string>('(loading)');
  const [fs, setFs] = useState<boolean>(false);
  // Phase 2: live mpv property snapshot driven by mpv-prop-change events.
  const [mpvProps, setMpvProps] = useState<Record<string, unknown>>({});
  const [lastEvent, setLastEvent] = useState<string>('');

  // Phase 1: call blissfulDesktop.getAppVersion() + subscribe to fullscreen
  // events to verify the typed IPC + Event direction both work.
  useEffect(() => {
    if (!isNativeShell()) {
      setAppVersion('(not running in shell)');
      return;
    }
    desktop
      .getAppVersion()
      .then((v) => setAppVersion(v))
      .catch((e) => setAppVersion(`(error: ${e.message ?? e})`));
    desktop.isFullscreen().then(setFs).catch(() => {});
    const unsubFs = desktop.onFullscreenChanged((newFs) => setFs(newFs));

    // Phase 2: subscribe to mpv property changes + lifecycle events.
    const unsubProp = desktop.onMpvPropChange(({ name, value }) => {
      setMpvProps((prev) => ({ ...prev, [name]: value }));
    });
    const unsubEvt = desktop.onMpvEvent((e) => {
      setLastEvent(e.reason ? `${e.type} (${e.reason})` : e.type);
    });

    return () => {
      unsubFs();
      unsubProp();
      unsubEvt();
    };
  }, []);

  // Log to the shell on mount — exercises the file-writing log command,
  // exit-criteria #1 from plan.md Phase 1.
  useEffect(() => {
    if (isNativeShell()) {
      desktop.log(`[player-spike] mounted at ${new Date().toISOString()}`).catch(() => {});
    }
  }, []);

  // Override root-level CSS for the spike. With the WebView2 controller's
  // DefaultBackgroundColor = (a=0), these `background: transparent` rules
  // let libmpv's render surface composite through.
  useEffect(() => {
    const prev = {
      html: document.documentElement.style.background,
      body: document.body.style.background,
      root: (document.getElementById('root')?.style.background ?? ''),
    };
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const root = document.getElementById('root');
    if (root) root.style.background = 'transparent';
    return () => {
      document.documentElement.style.background = prev.html;
      document.body.style.background = prev.body;
      if (root) root.style.background = prev.root;
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        color: 'white',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        userSelect: 'none',
        background: 'transparent',
      }}
    >
      {/* Top strip — back-button placeholder, semi-opaque dark bg */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 60,
          background: 'rgba(0, 0, 0, 0.6)',
          padding: 16,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          fontSize: 13,
        }}
      >
        ← Back (Phase 0b — React-rendered top strip, should bleed video through 40%)
      </div>

      {/* Middle marker — proves a label is rendered but doesn't block clicks */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          padding: '12px 18px',
          background: 'rgba(0, 0, 0, 0.55)',
          borderRadius: 6,
          fontSize: 12,
          pointerEvents: 'none',
          lineHeight: 1.6,
          textAlign: 'center',
        }}
      >
        Phase 0b — real React DOM. Middle is transparent. Video must be visible.
        <br />
        <span style={{ opacity: 0.85 }}>
          Phase 1: getAppVersion() = <b>{appVersion}</b>
        </span>
        <br />
        <span style={{ opacity: 0.85, fontVariantNumeric: 'tabular-nums' }}>
          Phase 2 live mpv state:&nbsp;
          time={fmt(mpvProps['time-pos'])}s / {fmt(mpvProps['duration'])}s,&nbsp;
          pause={String(mpvProps['pause'] ?? '?')},&nbsp;
          vol={fmt(mpvProps['volume'])}
          {lastEvent ? <> · last event: <b>{lastEvent}</b></> : null}
        </span>
      </div>

      {/* Bottom strip — Play/Pause + label */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: 80,
          background: 'rgba(0, 0, 0, 0.6)',
          padding: 16,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 13,
        }}
      >
        <button
          onClick={() => desktop.play().catch(() => {})}
          style={buttonStyle}
        >
          Play
        </button>
        <button
          onClick={() => desktop.pause().catch(() => {})}
          style={buttonStyle}
        >
          Pause
        </button>
        <button
          onClick={() => desktop.seek(-2).catch(() => {})}
          style={buttonStyle}
        >
          −2s
        </button>
        <button
          onClick={() => desktop.seek(2).catch(() => {})}
          style={buttonStyle}
        >
          +2s
        </button>
        <button
          onClick={() => desktop.mpv.setProperty('volume', 50).catch(() => {})}
          style={buttonStyle}
        >
          Vol 50
        </button>
        <button
          onClick={() => desktop.mpv.setProperty('volume', 100).catch(() => {})}
          style={buttonStyle}
        >
          Vol 100
        </button>
        <button
          onClick={() => desktop.toggleFullscreen().catch(() => {})}
          style={buttonStyle}
        >
          {fs ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
        <span style={{ opacity: 0.9 }}>
          {fs ? 'Fullscreen' : 'Windowed'}
        </span>
      </div>
    </div>
  );
}
