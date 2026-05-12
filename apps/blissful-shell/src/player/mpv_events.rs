// Owned/Send-able representation of libmpv2 events for transport across
// thread boundaries. libmpv2::Event<'a> borrows from the Mpv context — we
// have to materialize anything we want to forward before crossing the
// flume channel back to the UI thread.
//
// Events surfaced to the renderer match the shape stremio-shell-ng uses
// in `stremio_app/stremio_player/communication.rs`, with our IPC envelope
// (Outgoing::Event) wrapping them:
//
//   { type: "event", event: "mpv-prop-change", data: { name, value } }
//   { type: "event", event: "mpv-event",      data: { type: "FileLoaded" } }

use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum OwnedMpvEvent {
    /// A property we observe changed. `value` is JSON-encoded according
    /// to the format we asked for (string, bool, i64, f64).
    PropChange { name: String, value: Value },
    /// One of the player lifecycle events we forward.
    Lifecycle { name: String },
    /// Playback ended; reason is mpv's `end-file` reason string.
    EndFile { reason: String },
    /// libmpv is shutting down — event loop is about to exit.
    Shutdown,
}

impl OwnedMpvEvent {
    /// Translate this owned event into the `(event_name, data)` shape used
    /// by the renderer-side `blissfulDesktop.on(event, cb)` API.
    pub fn to_renderer(&self) -> (&'static str, Value) {
        match self {
            Self::PropChange { name, value } => (
                "mpv-prop-change",
                json!({ "name": name, "value": value }),
            ),
            Self::Lifecycle { name } => ("mpv-event", json!({ "type": name })),
            Self::EndFile { reason } => (
                "mpv-event",
                json!({ "type": "EndFile", "reason": reason }),
            ),
            Self::Shutdown => ("mpv-event", json!({ "type": "Shutdown" })),
        }
    }
}

/// Properties we observe by default. (name, libmpv Format). Names match
/// mpv's documented property names so the renderer can subscribe by name.
pub const OBSERVED_PROPERTIES: &[(&str, libmpv2::Format)] = &[
    ("time-pos", libmpv2::Format::Double),
    // `playback-time` is `time-pos` normalized so playback always starts
    // at 0, regardless of the file's internal start timestamp (some MKVs
    // ship with non-zero start_time from edit lists / chapter offsets).
    // SRT/VTT cue timestamps are authored against this 0-based clock, so
    // the subtitle overlay MUST compare against `playback-time` — using
    // `time-pos` produces a fixed 5-10s drift on those files.
    ("playback-time", libmpv2::Format::Double),
    ("duration", libmpv2::Format::Double),
    ("pause", libmpv2::Format::Flag),
    ("paused-for-cache", libmpv2::Format::Flag),
    ("volume", libmpv2::Format::Double),
    ("mute", libmpv2::Format::Flag),
    ("eof-reached", libmpv2::Format::Flag),
    ("idle-active", libmpv2::Format::Flag),
    ("aid", libmpv2::Format::Int64),
    ("sid", libmpv2::Format::Int64),
    // Reports the video's transfer characteristic, e.g. "pq" (HDR10/+),
    // "hlg" (HLG), or "bt.1886" (SDR). Stremio's player surfaces an
    // HDR badge whenever this is "pq" or "hlg" — we observe it as a
    // string and dispatch the same UI cue in the renderer.
    ("video-params/gamma", libmpv2::Format::String),
    // `seeking` flips true while mpv is processing a seek (before the
    // new position has actually rendered). Stremio's player OR's this
    // with `paused-for-cache` into a single `buffering` boolean —
    // either one going false dismisses the loader, which is exactly
    // what we need to fix stuck-loader cases where one of the two
    // false transitions doesn't reach us.
    ("seeking", libmpv2::Format::Flag),
];
