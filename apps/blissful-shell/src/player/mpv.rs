// libmpv2 wrapper. Phase 0a established the basics (wid=parent_hwnd, no
// video_host wrapper). Phase 2 adds the event loop:
//
//   - We hold the main `Mpv` via Arc<Mpv> for issuing commands.
//   - We call `Mpv::create_client(Some("event-loop"))` to get a separate
//     handle that shares the same player core. This handle is moved into
//     a dedicated thread that runs `wait_event(-1.0)` in a loop.
//   - On that client we call `observe_property(...)` for each property in
//     OBSERVED_PROPERTIES so we get PropertyChange events.
//   - The event thread translates `libmpv2::Event<'a>` into our owned
//     `OwnedMpvEvent` and calls a `dispatcher` callback. The caller
//     (main_window) wires that callback to send through a flume channel
//     + ping an NWG Notice so the UI thread drains and posts to the
//     WebView2 from the correct thread (STA rule).
//
// Why a separate client: libmpv2 5.0's `wait_event` takes `&mut Mpv`,
// which conflicts with shared `Arc<Mpv>`. Separate handles via
// `create_client` are the libmpv-blessed way to get a Mpv we can own
// mutably on a worker thread while still hitting the same player.
//
// Error mapping: libmpv2::Error contains Rc<Error> and is NOT Send + Sync,
// so anyhow's `.context()` can't be used directly. We map via .map_err.

use crate::player::mpv_events::{OwnedMpvEvent, OBSERVED_PROPERTIES};
use anyhow::{anyhow, Result};
use libmpv2::{events::Event, events::PropertyData, Mpv};
use serde_json::{json, Value};
use std::sync::Arc;
use std::thread;
use tracing::{debug, error, info, warn};
use windows::Win32::Foundation::HWND;

/// Trait alias for the per-event dispatcher passed in by main_window. The
/// closure runs on the libmpv event thread; it must be Send + Sync because
/// the thread owns it. Typically the closure pushes through flume + pings
/// an NWG Notice to wake the UI thread.
pub trait EventDispatcher: Fn(OwnedMpvEvent) + Send + Sync + 'static {}
impl<T> EventDispatcher for T where T: Fn(OwnedMpvEvent) + Send + Sync + 'static {}

#[derive(Clone)]
pub struct Player {
    inner: Arc<Mpv>,
}

impl Player {
    pub fn init<D: EventDispatcher>(parent_hwnd: HWND, dispatcher: D) -> Result<Self> {
        // wid is an integer pointer to the HWND. windows 0.60's HWND.0 is
        // *mut c_void; through isize so we preserve the bit pattern.
        let wid: i64 = parent_hwnd.0 as isize as i64;

        // 1:1 copy of stremio-shell-ng/src/stremio_app/stremio_player/player.rs
        // `create_shareable_mpv`. ONLY these properties — no cache tuning, no
        // demuxer overrides. Stremio Desktop plays the same torrents on the
        // same machine fine with this minimal config; anything we add is a
        // deviation. Two non-Stremio additions kept because our shell
        // architecture requires them: `idle=yes` (mpv stays alive between
        // loadfiles instead of exiting when nothing's playing) and
        // `keep-open=yes` (don't auto-close on EOF — the renderer decides
        // what to load next).
        let mpv = Mpv::with_initializer(|init| {
            // Stremio's set — copied verbatim.
            init.set_property("wid", wid)?;
            init.set_property("title", "Blissful")?;
            init.set_property("audio-client-name", "Blissful")?;
            init.set_property("terminal", "yes")?;
            #[cfg(debug_assertions)]
            init.set_property("msg-level", "all=no,cplayer=debug")?;
            #[cfg(not(debug_assertions))]
            init.set_property("msg-level", "all=no")?;
            init.set_property("quiet", "yes")?;
            init.set_property("hwdec", "auto")?;
            // Required by our shell architecture (mpv hosted under a
            // transparent WebView2; we draw our own controls):
            init.set_property("idle", "yes")?;
            init.set_property("keep-open", "yes")?;
            init.set_property("osc", "no")?;
            init.set_property("osd-bar", "no")?;
            init.set_property("osd-level", 0i64)?;
            init.set_property("input-default-bindings", "no")?;
            init.set_property("input-vo-keyboard", "no")?;
            init.set_property("cursor-autohide", "no")?;
            init.set_property("sub-auto", "fuzzy")?;
            // Belt-and-suspenders: ensure subtitles render. mpv's default
            // is on, but if any prior state files (cache-dir,
            // watch_later) flipped it off, every sid we set would be a
            // silent visual no-op. Subtitles use the OSD overlay; the
            // OSD bar/level options above disable only the *status* OSD
            // (time/seek), not the sub overlay.
            init.set_property("sub-visibility", "yes")?;
            // ASS/SSA subtitle styling override. Without this, mpv keeps
            // each track's embedded ASS style (font, color, position)
            // and silently ignores `sub-color` / `sub-font-size` /
            // `sub-back-color` set from the renderer. Users complained:
            // "I've set a different color in settings but I don't see
            // it" — that's because ASS styling was winning. `force`
            // makes mpv apply our color / size / outline over any ASS
            // style. Most BluRay rips ship ASS subs; this is the only
            // way the user's settings actually show up.
            init.set_property("sub-ass-override", "force")?;
            // Single playback tuning: wait for 5 seconds of buffer before
            // resuming from underrun instead of mpv's 1s default. Same
            // total throughput either way (peer-limited), but groups the
            // unavoidable pauses into 1 long one instead of 10 micro-
            // pauses. Stremio Desktop tends to have warm caches so its 1s
            // default rarely triggers; we're streaming fresh.
            init.set_property("cache-pause-wait", 5.0f64)?;
            // Allow software amplification up to 200% for tracks that
            // were mastered quiet (a lot of WEBRips and torrents). mpv's
            // default volume-max is 130; the renderer's slider tops at
            // 200 to match.
            init.set_property("volume-max", 200.0f64)?;
            Ok(())
        })
        .map_err(|e| anyhow!("libmpv init: {e:?}"))?;

        info!("libmpv initialized with wid=parent_hwnd");

        // Get a separate handle for the event thread. It shares the same
        // player core so observe_property/wait_event see everything the
        // main Mpv is doing. `create_client` returns Result<Mpv>.
        //
        // KNOWN BUG in libmpv2 5.0.3 create_client: with `Some(name)` it
        // takes `.as_ptr()` from a temporary CString that's dropped at
        // end of expression, so mpv_create_client gets a dangling pointer
        // and returns NULL, which then trips `NonNull::new_unchecked`'s
        // safety precondition and aborts. The `None` branch uses
        // `ptr::null()` directly and is safe. The name is only a label
        // for mpv's logs anyway — fine to skip.
        let event_client = mpv
            .create_client(None)
            .map_err(|e| anyhow!("mpv create_client: {e:?}"))?;

        // Disable mpv's deprecated events to reduce noise in the loop.
        if let Err(e) = event_client.disable_deprecated_events() {
            warn!(error = ?e, "mpv: disable_deprecated_events failed");
        }

        // Observe the property set. reply_userdata is unused — we route
        // by name. mpv requires a value but accepts 0.
        for (name, format) in OBSERVED_PROPERTIES {
            if let Err(e) = event_client.observe_property(name, *format, 0) {
                warn!(prop = %name, error = ?e, "observe_property failed");
            }
        }

        // Spawn the event thread. Ownership of event_client moves in.
        // The dispatcher closure runs here, but does the cross-thread
        // bouncing via flume+Notice (caller's responsibility).
        let dispatcher = Arc::new(dispatcher);
        let dispatcher_for_thread = Arc::clone(&dispatcher);
        thread::Builder::new()
            .name("mpv-events".into())
            .spawn(move || run_event_loop(event_client, dispatcher_for_thread))
            .map_err(|e| anyhow!("spawn mpv event thread: {e}"))?;

        Ok(Self {
            inner: Arc::new(mpv),
        })
    }

    pub fn load_file(&self, path: &str) -> Result<()> {
        self.inner
            .command("loadfile", &[path])
            .map_err(|e| anyhow!("mpv loadfile {path}: {e:?}"))?;
        Ok(())
    }

    pub fn set_pause(&self, paused: bool) -> Result<()> {
        self.inner
            .set_property("pause", paused)
            .map_err(|e| anyhow!("mpv set pause={paused}: {e:?}"))?;
        Ok(())
    }

    pub fn set_property_string(&self, name: &str, value: &str) -> Result<()> {
        self.inner
            .set_property(name, value)
            .map_err(|e| anyhow!("mpv set_property {name}={value}: {e:?}"))?;
        Ok(())
    }

    pub fn set_property_double(&self, name: &str, value: f64) -> Result<()> {
        self.inner
            .set_property(name, value)
            .map_err(|e| anyhow!("mpv set_property {name}={value}: {e:?}"))?;
        Ok(())
    }

    pub fn set_property_int(&self, name: &str, value: i64) -> Result<()> {
        self.inner
            .set_property(name, value)
            .map_err(|e| anyhow!("mpv set_property {name}={value}: {e:?}"))?;
        Ok(())
    }

    pub fn set_property_bool(&self, name: &str, value: bool) -> Result<()> {
        self.inner
            .set_property(name, value)
            .map_err(|e| anyhow!("mpv set_property {name}={value}: {e:?}"))?;
        Ok(())
    }

    pub fn command(&self, name: &str, args: &[&str]) -> Result<()> {
        self.inner
            .command(name, args)
            .map_err(|e| anyhow!("mpv command {name}: {e:?}"))?;
        Ok(())
    }

    /// Walk mpv's `track-list/N/...` properties and return one TrackInfo
    /// per track. libmpv2 5.0 panics on `Format::Node`, so we can't read
    /// `track-list` as a whole — instead we iterate the per-track
    /// sub-properties which are all primitives.
    pub fn get_tracks(&self) -> Result<Vec<TrackInfo>> {
        let count: i64 = self
            .inner
            .get_property("track-list/count")
            .map_err(|e| anyhow!("mpv get track-list/count: {e:?}"))?;
        let mut out = Vec::with_capacity(count.max(0) as usize);
        for i in 0..count {
            let id: i64 = self
                .inner
                .get_property(&format!("track-list/{i}/id"))
                .unwrap_or(-1);
            let ttype: String = self
                .inner
                .get_property(&format!("track-list/{i}/type"))
                .unwrap_or_default();
            let title: Option<String> = self
                .inner
                .get_property(&format!("track-list/{i}/title"))
                .ok();
            let lang: Option<String> = self
                .inner
                .get_property(&format!("track-list/{i}/lang"))
                .ok();
            let codec: Option<String> = self
                .inner
                .get_property(&format!("track-list/{i}/codec"))
                .ok();
            let selected: bool = self
                .inner
                .get_property(&format!("track-list/{i}/selected"))
                .unwrap_or(false);
            out.push(TrackInfo {
                id,
                kind: ttype,
                title,
                lang,
                codec,
                selected,
            });
        }
        Ok(out)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TrackInfo {
    pub id: i64,
    /// mpv's track "type" — "audio" / "video" / "sub".
    pub kind: String,
    pub title: Option<String>,
    pub lang: Option<String>,
    pub codec: Option<String>,
    pub selected: bool,
}

fn run_event_loop(mut mpv: Mpv, dispatcher: Arc<dyn EventDispatcher<Output = ()>>) {
    info!("mpv event loop started");
    loop {
        match mpv.wait_event(-1.0) {
            Some(Ok(event)) => {
                let owned = translate_event(&event);
                let is_shutdown = matches!(owned, Some(OwnedMpvEvent::Shutdown));
                if let Some(ev) = owned {
                    dispatcher(ev);
                }
                if is_shutdown {
                    info!("mpv shutdown event — exiting event loop");
                    break;
                }
            }
            Some(Err(e)) => {
                error!(error = ?e, "mpv event error");
            }
            None => {
                debug!("mpv: spurious wake (no event)");
            }
        }
    }
}

fn translate_event(event: &Event<'_>) -> Option<OwnedMpvEvent> {
    match event {
        Event::PropertyChange { name, change, .. } => {
            let value = property_data_to_json(change);
            Some(OwnedMpvEvent::PropChange {
                name: name.to_string(),
                value,
            })
        }
        Event::FileLoaded => Some(OwnedMpvEvent::Lifecycle {
            name: "FileLoaded".into(),
        }),
        Event::StartFile => Some(OwnedMpvEvent::Lifecycle {
            name: "StartFile".into(),
        }),
        Event::Seek => Some(OwnedMpvEvent::Lifecycle {
            name: "Seek".into(),
        }),
        Event::PlaybackRestart => Some(OwnedMpvEvent::Lifecycle {
            name: "PlaybackRestart".into(),
        }),
        Event::EndFile(reason) => Some(OwnedMpvEvent::EndFile {
            reason: format!("{reason:?}"),
        }),
        Event::Shutdown => Some(OwnedMpvEvent::Shutdown),
        // Skip noisy or non-actionable events for now. Phase 2.5 may
        // expand the set if the renderer needs more (tracks-changed,
        // video-reconfig).
        _ => None,
    }
}

fn property_data_to_json(p: &PropertyData<'_>) -> Value {
    match p {
        PropertyData::Str(s) => json!(s),
        PropertyData::OsdStr(s) => json!(s),
        PropertyData::Flag(b) => json!(b),
        PropertyData::Int64(i) => json!(i),
        PropertyData::Double(f) => json!(f),
    }
}
