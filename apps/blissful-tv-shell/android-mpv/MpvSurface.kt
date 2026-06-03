package com.blissful.tv.mpv

import android.app.Activity
import android.graphics.Color
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import android.webkit.WebView

/**
 * Compositing: a SurfaceView placed UNDER the (made-transparent) Tauri WebView,
 * mirroring Tauri's first-party barcode-scanner Android plugin. Video draws on
 * the SurfaceView's own SurfaceFlinger layer behind the window and shows through
 * the transparent WebView region; the React controls render above it.
 *
 * ⚠ PRE-SPIKE: this is the make-or-break risk. Validate on real TV hardware
 * (docs/PHASE2-SPIKE.md) before trusting it. `webView.parent as ViewGroup` is
 * wry-version-sensitive — pin tauri/wry and re-run the spike on upgrade.
 */
class MpvSurface(
    private val activity: Activity,
    private val webView: WebView,
    private val mpv: MpvBridge,
) {
    private var surfaceView: SurfaceView? = null
    private var attached = false
    // App background (#0a0a0a) — restored on detach. The player is a fullscreen
    // route in v1, so we never need the WebView opaque while a surface exists.
    private val restoreColor = Color.parseColor("#0a0a0a")

    fun attach() {
        if (attached) return
        attached = true
        activity.runOnUiThread {
            val parent = webView.parent as ViewGroup
            val sv = SurfaceView(activity)
            surfaceView = sv
            // index 0 = drawn first = BEHIND the WebView.
            parent.addView(sv, 0)
            webView.setBackgroundColor(Color.TRANSPARENT)
            webView.bringToFront()
            // Do NOT call sv.setZOrderOnTop(true) (hides DOM controls) nor
            // setZOrderMediaOverlay(true) (only for stacking two SurfaceViews).
            sv.holder.addCallback(holderCallback)
        }
    }

    fun detach() {
        if (!attached) return
        attached = false
        activity.runOnUiThread {
            surfaceView?.let { (it.parent as? ViewGroup)?.removeView(it) }
            surfaceView = null
            webView.setBackgroundColor(restoreColor)
        }
    }

    private val holderCallback = object : SurfaceHolder.Callback {
        override fun surfaceCreated(holder: SurfaceHolder) {
            mpv.attachSurface(holder.surface)
        }

        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            // Must fire on every resize/rotation/fullscreen toggle (Windows WM_SIZE analog).
            mpv.setSurfaceSize(width, height)
        }

        override fun surfaceDestroyed(holder: SurfaceHolder) {
            // The framework frees this Surface the moment we return from here, so
            // libmpv must stop touching it FIRST. Just calling detachSurface()
            // (vo=null + free the ANativeWindow) doesn't hard-block for the VO
            // render thread, so on background (TV Home) the thread was still live
            // when the window was freed → FORTIFY "pthread_mutex_lock on a
            // destroyed mutex" SIGSEGV. Stop playback first to quiesce the VO,
            // THEN detach. Both calls are @Synchronized + guarded in MpvBridge.
            mpv.stopPlayback()
            mpv.detachSurface()
        }
    }
}
