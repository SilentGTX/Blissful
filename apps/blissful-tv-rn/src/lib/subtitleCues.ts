// Subtitle cue parsing for the player's STYLED subtitle overlay.
//
// expo-video renders embedded subtitle tracks itself, with ExoPlayer's fixed
// white-on-black and NO styling hook (unlike the web's `::cue` CSS or mpv's
// sub-color). To honour the user's saved subtitle profile (colour / background /
// outline / size) we render subtitles OURSELVES: fetch the addon-provided
// .srt/.vtt, parse it into timed cues, and draw the active cue as a styled
// overlay synced to the player clock (see SubtitleOverlay.tsx). Mirrors the web
// app's "fetch → srtToVtt → render" pipeline, just with our own renderer.

export type SubtitleCue = { start: number; end: number; text: string };

// "00:01:02,500" / "00:01:02.500" / "01:02.500" → seconds. Comma or dot decimals.
function parseTimestamp(ts: string): number {
  const m = ts.trim().replace(',', '.').match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})\.(\d{1,3})/);
  if (!m) return NaN;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const ms = Number((m[4] + '000').slice(0, 3));
  return h * 3600 + min * 60 + sec + ms / 1000;
}

// Parse SRT or WebVTT into time-sorted cues. Strips index lines, the WEBVTT
// header, cue settings after the timestamp, and inline tags (<i>, <b>, {\an8}).
export function parseSubtitles(raw: string): SubtitleCue[] {
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^WEBVTT[^\n]*\n/, '');
  const cues: SubtitleCue[] = [];
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const tsIdx = lines.findIndex((l) => l.includes('-->'));
    if (tsIdx === -1) continue;
    const parts = lines[tsIdx].split('-->');
    const start = parseTimestamp(parts[0]);
    const end = parseTimestamp((parts[1] ?? '').trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    const cueText = lines
      .slice(tsIdx + 1)
      .join('\n')
      .replace(/\{\\[^}]*\}/g, '') // ASS override tags
      .replace(/<[^>]+>/g, '') // html/vtt tags
      .trim();
    if (cueText) cues.push({ start, end, text: cueText });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

export async function fetchSubtitleCues(url: string, signal?: AbortSignal): Promise<SubtitleCue[]> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`subtitle fetch failed (${res.status})`);
  return parseSubtitles(await res.text());
}

// Active cue text at time `t` (seconds), with a delay offset applied. Linear
// scan — subtitle files are a few thousand cues at most.
export function activeCueText(cues: SubtitleCue[], t: number, delaySeconds = 0): string | null {
  const at = t - delaySeconds;
  for (const c of cues) {
    if (at < c.start) break; // sorted — nothing later can match earlier
    if (at <= c.end) return c.text;
  }
  return null;
}
