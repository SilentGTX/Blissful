// System tray: a small Blissful icon next to the clock that exposes
// show/hide and quit. Mirrors what apps/blissful-desktop's Electron build
// gave users; matches Phase 5 of plan.md.
//
// Icon is embedded at compile time via include_bytes! so we never need
// resources/icon.ico to exist on the user's disk at runtime — the .ico
// bytes are baked into blissful-shell.exe.

use anyhow::{Context, Result};
use native_windows_gui as nwg;

const ICON_BYTES: &[u8] = include_bytes!("../resources/icon.ico");

pub struct Tray {
    // NWG keeps the underlying HWND/icon registered with USER32 for the
    // lifetime of these structs — drop them and the tray icon disappears.
    pub icon: nwg::Icon,
    pub tray: nwg::TrayNotification,
    pub menu: nwg::Menu,
    pub item_quit: nwg::MenuItem,
}

impl Tray {
    /// Build the tray. `parent` is the main HWND (used as owner so the
    /// tray icon goes away when the window goes away).
    pub fn build(parent: &nwg::Window) -> Result<Self> {
        let mut icon = nwg::Icon::default();
        nwg::Icon::builder()
            .source_bin(Some(ICON_BYTES))
            .strict(true)
            .build(&mut icon)
            .context("build tray icon from embedded bytes")?;

        let mut tray = nwg::TrayNotification::default();
        nwg::TrayNotification::builder()
            .parent(parent)
            .icon(Some(&icon))
            .tip(Some("Blissful"))
            .visible(true)
            .build(&mut tray)
            .context("build tray notification")?;

        let mut menu = nwg::Menu::default();
        nwg::Menu::builder()
            .parent(parent)
            .popup(true)
            .build(&mut menu)
            .context("build tray menu")?;

        // Stremio's tray menu only has "Quit" — no Show/Hide. Left-
        // clicking the icon brings the window to front (handled in
        // main_window.rs), which is the only "show" people use.
        let mut item_quit = nwg::MenuItem::default();
        nwg::MenuItem::builder()
            .parent(&menu)
            .text("Quit")
            .build(&mut item_quit)
            .context("build tray menu Quit")?;

        Ok(Self {
            icon,
            tray,
            menu,
            item_quit,
        })
    }

    /// Pop the context menu at the cursor position. NWG measures the
    /// click + dispatches MenuItem clicks via OnMenuItemSelected.
    pub fn popup_menu(&self) {
        let (x, y) = nwg::GlobalCursor::position();
        self.menu.popup(x, y);
    }
}
