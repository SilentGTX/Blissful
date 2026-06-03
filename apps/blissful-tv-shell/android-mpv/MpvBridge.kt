package com.blissful.tv.mpv

import android.content.Context
import android.view.Surface
import dev.jdtech.mpv.MPVLib

/**
 * libmpv wrapper. Owns the MPVLib INSTANCE (v1.0.0 is instance-based, NOT the
 * old static MPVLib.command(...)), the 16 observed properties, the event loop,
 * the track/chapter serializers (which produce the exact MpvTrack/MpvChapter
 * JSON the React player expects), setProperty typing, and the EndFile reason
 * mapping the binge gate depends on.
 *
 * ⚠ PRE-SPIKE SCAFFOLD: the exact dev.jdtech.mpv:libmpv:1.0.0 method names and
 * the EventObserver overloads MUST be verified against the AAR (see
 * docs/PHASE2-SPIKE.md). The SHAPE here is correct; signatures may differ.
 */
class MpvBridge {

    /** Emitted as {event:'mpv-prop-change', data:{name, value}}. value may be
     *  Long/Double/Boolean/String, or null to clear (e.g. on file change). */
    var onProp: ((name: String, value: Any?) -> Unit)? = null

    /** Emitted as {event:'mpv-event', data:{type, reason?}}. */
    var onEvent: ((type: String, reason: String?) -> Unit)? = null

    private var mpv: MPVLib? = null

    // Crash-hardening for the surface/VO teardown race (the FORTIFY
    // "pthread_mutex_lock on a destroyed mutex" SIGSEGV). `hasSurface` makes
    // attach/detach idempotent so a stray surfaceDestroyed (e.g. on background)
    // can't free the ANativeWindow twice; `destroyed` short-circuits every call
    // once mpv is gone. All surface/command/lifecycle entry points below are
    // @Synchronized so the JS-bridge thread, the SurfaceHolder callbacks, and
    // teardown can't interleave their native calls into one MPVLib instance.
    private var hasSurface = false
    @Volatile private var destroyed = false

    // mpv format ids
    private companion object {
        const val FORMAT_NONE = 0
        const val FORMAT_STRING = 1
        const val FORMAT_FLAG = 3
        const val FORMAT_INT64 = 4
        const val FORMAT_DOUBLE = 5

        // mpv event ids
        const val EVENT_SHUTDOWN = 1
        const val EVENT_START_FILE = 6
        const val EVENT_END_FILE = 7
        const val EVENT_FILE_LOADED = 8
        const val EVENT_SEEK = 20
        const val EVENT_PLAYBACK_RESTART = 21

        // The 16 observed properties → format. Must match the Windows shell's
        // OBSERVED_PROPERTIES (mpv_events.rs:51-95).
        val OBSERVED: List<Pair<String, Int>> = listOf(
            "time-pos" to FORMAT_DOUBLE,
            "playback-time" to FORMAT_DOUBLE,
            "duration" to FORMAT_DOUBLE,
            "pause" to FORMAT_FLAG,
            "paused-for-cache" to FORMAT_FLAG,
            "volume" to FORMAT_DOUBLE,
            "mute" to FORMAT_FLAG,
            "eof-reached" to FORMAT_FLAG,
            "idle-active" to FORMAT_FLAG,
            "aid" to FORMAT_INT64,
            "sid" to FORMAT_INT64,
            "video-params/gamma" to FORMAT_STRING,
            "dwidth" to FORMAT_INT64,
            "dheight" to FORMAT_INT64,
            "seeking" to FORMAT_FLAG,
            "chapter" to FORMAT_INT64,
        )

        // Throttle the two high-frequency props on the Kotlin side (~5 Hz),
        // mirroring the Windows shell, so we don't flood the JS bridge.
        val THROTTLED = setOf("time-pos", "playback-time")
        const val THROTTLE_MS = 200L
    }

    private val lastEmit = HashMap<String, Long>()
    // Cached `eof-reached` flag — used to infer the EndFile reason, which
    // v1.0.0's MPVLib does not surface (see the END_FILE handler).
    private var lastEofReached = false

    fun init(context: Context) {
        // create() returns MPVLib? in v1.0.0 (null when the native handle is 0).
        val m = MPVLib.create(context)
            ?: throw IllegalStateException("MPVLib.create returned null")
        // Decode + output options. vo=gpu + libass = embedded ASS force-style
        // parity (the whole reason we use libmpv over media3).
        m.setOptionString("vo", "gpu")
        m.setOptionString("gpu-context", "android")
        m.setOptionString("hwdec", "mediacodec")      // fallback chain: mediacodec-copy -> no
        m.setOptionString("volume-max", "200")        // 0–200 slider parity (must be pre-init)
        m.setOptionString("input-default-bindings", "no")
        m.setOptionString("input-vo-keyboard", "no")
        m.setOptionString("ytdl", "no")
        // HTTP(S) streaming options passed to ffmpeg's protocol layer.
        // multiple_requests=1 keeps the TLS connection alive across Range
        // requests, so the unavoidable MKV header seek-to-EOF + seek-back-to-
        // start reuse ONE connection instead of paying a fresh (~slow on this
        // device) TLS handshake per seek — the difference between ~1 connect and
        // several at startup. reconnect* makes a dropped debrid CDN socket
        // self-heal instead of ending the file.
        m.setOptionString(
            "stream-lavf-o",
            "multiple_requests=1,reconnect=1,reconnect_streamed=1,reconnect_delay_max=5",
        )
        // BOUND the demuxer cache. libmpv's defaults (demuxer-max-bytes 150 MiB +
        // demuxer-max-back-bytes 75 MiB = ~225 MB) are catastrophic on a ~1.3 GB-RAM
        // TV with ~300-600 MB free — they push the app to OOM/zram-thrash while
        // streaming 1080p, which itself worsens stalls. Cap to ~50 MiB forward /
        // 16 MiB back (still ~40-60 s of buffer at typical bitrates) so playback has
        // headroom without starving the rest of the system. Modest readahead +
        // fast resume after a brief underrun.
        m.setOptionString("cache", "yes")
        m.setOptionString("demuxer-max-bytes", "52428800")       // 50 MiB forward
        m.setOptionString("demuxer-max-back-bytes", "16777216")  // 16 MiB back
        m.setOptionString("demuxer-readahead-secs", "20")
        m.setOptionString("cache-pause-wait", "1")
        m.init()

        // Observe the 16 properties.
        for ((name, fmt) in OBSERVED) m.observeProperty(name, fmt)

        m.addObserver(observer)
        mpv = m
    }

    @Synchronized
    fun attachSurface(surface: Surface) {
        val m = mpv ?: return
        if (destroyed) return
        // Restore the GPU VO (detachSurface sets vo=null) so re-attaching after a
        // background round-trip resumes rendering instead of staying black.
        m.setOptionString("vo", "gpu")
        m.attachSurface(surface)
        m.setOptionString("force-window", "yes")
        hasSurface = true
    }

    @Synchronized
    fun detachSurface() {
        val m = mpv ?: return
        // Idempotent: a second surfaceDestroyed (or a detach after we already
        // tore down) must NOT free the surface again under the VO thread.
        if (!hasSurface) return
        hasSurface = false
        // Tell the VO to release the surface BEFORE libmpv frees the
        // ANativeWindow. Callers doing a controlled teardown should stopPlayback()
        // first (quiesces the render thread) — vo=null alone does not hard-block.
        m.setPropertyString("vo", "null")
        m.setOptionString("force-window", "no")
        m.detachSurface()
    }

    @Synchronized
    fun setSurfaceSize(w: Int, h: Int) {
        // The Android analog of the Windows WM_SIZE → resize path. Must fire on
        // every surfaceChanged or video mis-scales. No-op if no surface is bound.
        if (!hasSurface || destroyed) return
        mpv?.setPropertyString("android-surface-size", "${w}x${h}")
    }

    /** Stop the current file so the VO goes idle and releases the surface.
     *  Called before a controlled detach / on backgrounding so libmpv's render
     *  thread isn't live when the ANativeWindow is freed. */
    @Synchronized
    fun stopPlayback() {
        if (destroyed) return
        mpv?.command(arrayOf("stop"))
    }

    @Synchronized
    fun command(args: Array<String>) {
        if (destroyed) return
        mpv?.command(args)
    }

    @Synchronized
    fun setPropertyBoolean(name: String, value: Boolean) {
        if (destroyed) return
        mpv?.setPropertyBoolean(name, value)
    }

    /** setProperty typing: Bool -> boolean; Number/anything -> string. Routing
     *  numbers through setPropertyString sidesteps MPVLib's strict typed setters
     *  (the critic-confirmed simplification; the only real numeric call site is
     *  `volume`). */
    @Synchronized
    fun setPropertyAny(name: String, value: Any?) {
        val m = mpv ?: return
        if (destroyed) return
        when (value) {
            is Boolean -> m.setPropertyBoolean(name, value)
            null -> { /* ignore */ }
            else -> m.setPropertyString(name, value.toString())
        }
    }

    /** Walk track-list/N → MpvTrack[]. Mirrors the Windows count-then-loop
     *  (mpv.rs:221-262) because MPVLib, like libmpv2, has only typed getters. */
    fun getTracksJson(): List<Map<String, Any?>> {
        val m = mpv ?: return emptyList()
        val count = m.getPropertyInt("track-list/count") ?: 0
        val out = ArrayList<Map<String, Any?>>(count)
        for (i in 0 until count) {
            val kind = m.getPropertyString("track-list/$i/type") ?: continue
            out.add(
                mapOf(
                    "id" to (m.getPropertyInt("track-list/$i/id") ?: 0),
                    "kind" to kind,                                    // "audio" | "video" | "sub"
                    "title" to m.getPropertyString("track-list/$i/title"),
                    "lang" to m.getPropertyString("track-list/$i/lang"),
                    "codec" to m.getPropertyString("track-list/$i/codec"),
                    "selected" to (m.getPropertyBoolean("track-list/$i/selected") ?: false),
                )
            )
        }
        return out
    }

    /** Walk chapter-list/N → MpvChapter[] (time, title). */
    fun getChaptersJson(): List<Map<String, Any?>> {
        val m = mpv ?: return emptyList()
        val count = m.getPropertyInt("chapter-list/count") ?: 0
        val out = ArrayList<Map<String, Any?>>(count)
        for (i in 0 until count) {
            out.add(
                mapOf(
                    "time" to (m.getPropertyDouble("chapter-list/$i/time") ?: 0.0),
                    "title" to m.getPropertyString("chapter-list/$i/title"),
                )
            )
        }
        return out
    }

    @Synchronized
    fun destroy() {
        if (destroyed) return
        destroyed = true
        hasSurface = false
        mpv?.let {
            it.removeObserver(observer)
            // nativeDestroy pthread_joins the VO/event threads — the only path
            // that waits for them, so this is safe to call once at teardown.
            it.destroy()
        }
        mpv = null
    }

    // --- event loop (runs on libmpv's native thread) ---
    private val observer = object : MPVLib.EventObserver {
        override fun eventProperty(property: String) = emitProp(property, null)
        override fun eventProperty(property: String, value: Long) = emitProp(property, value)
        override fun eventProperty(property: String, value: Boolean) = emitProp(property, value)
        override fun eventProperty(property: String, value: String) = emitProp(property, value)
        override fun eventProperty(property: String, value: Double) = emitProp(property, value)

        override fun event(eventId: Int) {
            when (eventId) {
                EVENT_FILE_LOADED -> onEvent?.invoke("FileLoaded", null)
                // Reset the EOF flag at the start of each file so this playback's
                // EndFile reason reflects its own eof-reached, not a prior file's.
                EVENT_START_FILE -> { lastEofReached = false; onEvent?.invoke("StartFile", null) }
                EVENT_SEEK -> onEvent?.invoke("Seek", null)
                EVENT_PLAYBACK_RESTART -> onEvent?.invoke("PlaybackRestart", null)
                EVENT_SHUTDOWN -> onEvent?.invoke("Shutdown", null)
                EVENT_END_FILE -> {
                    // v1.0.0's MPVLib does NOT deliver the end-file reason (the
                    // native event.cpp discards the mpv_event_end_file.reason and
                    // there is no `end-file-reason` property). Infer it: a true
                    // `eof-reached` immediately before END_FILE = natural EOF;
                    // otherwise a manual stop / loadfile-replace. The binge/up-next
                    // gate is `(reason||'').toLowerCase() === 'eof'`.
                    onEvent?.invoke("EndFile", if (lastEofReached) "eof" else "stop")
                }
            }
        }
    }

    private fun emitProp(name: String, value: Any?) {
        // Cache eof-reached for the END_FILE reason inference above.
        if (name == "eof-reached" && value is Boolean) lastEofReached = value
        if (name in THROTTLED) {
            // TODO(spike): MEASURE the post-throttle cadence stays >=5 Hz.
            val now = System.currentTimeMillis()
            val last = lastEmit[name] ?: 0L
            if (now - last < THROTTLE_MS) return
            lastEmit[name] = now
        }
        onProp?.invoke(name, value)
    }
}
