package com.blissful.tv.mpv

import android.app.Activity
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray

// Payloads — must match the JSON the Rust router (src/mpv.rs) sends.
@InvokeArg
class SeekArgs {
    var seconds: Double = 0.0
    var mode: String = "relative"
}

@InvokeArg
class CommandArgs {
    var name: String = ""
    var args: List<String> = emptyList()
}

@InvokeArg
class SetPropertyArgs {
    var name: String = ""
    var value: Any? = null
}

/**
 * Tauri plugin behind window.blissfulDesktop's player verbs. Owns the libmpv
 * wrapper (MpvBridge) + the SurfaceView-under-transparent-WebView compositing
 * (MpvSurface). Bridges libmpv's prop/event stream back to the renderer via
 * `trigger(...)`, preserving the exact mpv-prop-change / mpv-event envelopes the
 * React player (NativeMpvPlayer.tsx) already consumes.
 *
 * ⚠ PRE-SPIKE: verify the dev.jdtech.mpv:libmpv:1.0.0 + app.tauri.plugin
 * signatures, and that `trigger` events reach the renderer (see the note in
 * apps/blissful-mvs/src/lib/tauriBridge.ts about plugin-scoped vs global events).
 */
@TauriPlugin
class BlissfulMpvPlugin(private val activity: Activity) : Plugin(activity) {
    private val mpv = MpvBridge()
    private var surface: MpvSurface? = null
    private var webView: WebView? = null

    // Deliver mpv prop/event envelopes straight into the page. Tauri's plugin
    // event system (trigger() -> JS addPluginListener) is unusable here: the JS
    // `plugin:blissful-mpv|registerListener` invoke is DENIED by the capability
    // ACL because this in-crate plugin (tauri::plugin::Builder in src/mpv.rs)
    // ships no permission set — so trigger()'d events never reach a listener.
    // Instead push via evaluateJavascript into window.__blissMpvEmit, which
    // tauriBridge.ts fans out to onMpvPropChange/onMpvEvent subscribers.
    // Events arrive on libmpv's native thread; evaluateJavascript must run on
    // the UI thread.
    private fun emit(event: String, data: JSObject) {
        val wv = webView ?: return
        val payload = data.toString() // JSON object — a valid JS object literal
        val js = "window.__blissMpvEmit&&window.__blissMpvEmit(\"$event\",$payload)"
        activity.runOnUiThread {
            try {
                wv.evaluateJavascript(js, null)
            } catch (_: Throwable) {
                // WebView torn down / not yet ready — drop the event.
            }
        }
    }

    override fun load(webView: WebView) {
        this.webView = webView
        // Android TV scaling: a 1920px panel at density 2.0 gives the WebView only
        // a 960 CSS-px viewport, so the 1920-designed UI renders ~2x too big. Enable
        // wide-viewport HERE — this plugin file survives wry's per-build regeneration
        // of RustWebView.kt — so the WebView honors index.html's <meta viewport
        // width=1920> and scales that 1920 layout down to fit the panel.
        webView.settings.useWideViewPort = true
        webView.settings.loadWithOverviewMode = true
        // Sideload diagnostics: enable chrome://inspect remote debugging so the
        // live WebView (console / network / DOM) can be inspected from the PC.
        // (Disable before any public release.)
        android.webkit.WebView.setWebContentsDebuggingEnabled(true)

        // Hardware BACK on the TV remote is otherwise swallowed by the System
        // WebView's built-in onKeyDown (it does goBack() over the SPA history),
        // so it never reaches the page's JS keydown handlers — pressing Back
        // inside a player overlay would jump the whole route back instead of
        // closing the overlay. An OnKeyListener fires before View.onKeyDown, so
        // intercept BACK here and hand it to the page: window.__blissOnBack()
        // (defined only while the native player is mounted) returns "true" when
        // it consumed the press (closed an overlay / stepped out of the control
        // row / left the player via the clean route); otherwise — and on every
        // non-player screen where it's undefined — we perform the default
        // history-back / activity-finish, exactly what the WebView did before.
        webView.setOnKeyListener { _, keyCode, event ->
            if (keyCode == android.view.KeyEvent.KEYCODE_BACK) {
                if (event.action == android.view.KeyEvent.ACTION_UP) {
                    webView.evaluateJavascript(
                        "window.__blissOnBack ? window.__blissOnBack() : false"
                    ) { res ->
                        if (res != "true") {
                            activity.runOnUiThread {
                                if (webView.canGoBack()) webView.goBack() else activity.finish()
                            }
                        }
                    }
                }
                true // consume BACK (down + up) so the WebView's native goBack never runs
            } else {
                false // every other key (D-pad arrows, OK, media keys) passes through
            }
        }

        // Wire libmpv's event stream → the renderer, same envelopes as the
        // Windows shell's mpv_events.rs::to_renderer.
        mpv.onProp = { name, value ->
            val data = JSObject().put("name", name)
            when (value) {
                is Boolean -> data.put("value", value)
                is Long -> data.put("value", value)
                is Int -> data.put("value", value)
                is Double -> data.put("value", value)
                is String -> data.put("value", value)
                else -> data.put("value", org.json.JSONObject.NULL) // clear (e.g. gamma/dwidth on file change)
            }
            emit("mpv-prop-change", data)
        }
        mpv.onEvent = { type, reason ->
            val data = JSObject().put("type", type)
            if (reason != null) data.put("reason", reason)
            emit("mpv-event", data)
        }

        mpv.init(activity)
        surface = MpvSurface(activity, webView, mpv)
    }

    @Command
    fun play(invoke: Invoke) {
        mpv.setPropertyBoolean("pause", false)
        invoke.resolve()
    }

    @Command
    fun pause(invoke: Invoke) {
        mpv.setPropertyBoolean("pause", true)
        invoke.resolve()
    }

    @Command
    fun seek(invoke: Invoke) {
        val a = invoke.parseArgs(SeekArgs::class.java)
        // `+exact` = frame-accurate (Skip-Intro targets + watch-party drift).
        mpv.command(arrayOf("seek", a.seconds.toString(), "${a.mode}+exact"))
        invoke.resolve()
    }

    @Command
    fun mpvCommand(invoke: Invoke) {
        val a = invoke.parseArgs(CommandArgs::class.java)
        // Lazily composite the video surface on the first loadfile.
        if (a.name == "loadfile") surface?.attach()
        mpv.command((listOf(a.name) + a.args).toTypedArray())
        invoke.resolve()
    }

    @Command
    fun mpvSetProperty(invoke: Invoke) {
        val a = invoke.parseArgs(SetPropertyArgs::class.java)
        mpv.setPropertyAny(a.name, a.value)
        invoke.resolve()
    }

    @Command
    fun mpvGetTracks(invoke: Invoke) {
        // Wrapped in { value } — the Rust side (mpv.rs::get_tracks) unwraps it.
        invoke.resolve(JSObject().put("value", JSONArray(mpv.getTracksJson())))
    }

    @Command
    fun mpvGetChapters(invoke: Invoke) {
        invoke.resolve(JSObject().put("value", JSONArray(mpv.getChaptersJson())))
    }
}
