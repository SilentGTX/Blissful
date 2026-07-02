// Shared helpers between NativeMpvPlayer and its extracted
// SubtitleMenuPopover. The language → display-name table lives in
// lib/subtitleUtils.ts (the web player's copy) and is re-exported here so
// the desktop and web players canonicalize languages identically — the two
// tables were byte-identical duplicates, and a fix landing in only one of
// them (BCP-47 folding: "en-US" → "English") is exactly the drift this
// re-export prevents.

export { subtitleLangLabel } from '../../lib/subtitleUtils';
