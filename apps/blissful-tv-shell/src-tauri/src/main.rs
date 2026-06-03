// Desktop entry point. On Android/iOS, Tauri generates its own entry that calls
// `blissful_tv_lib::run()` directly (see the `mobile_entry_point` macro in
// lib.rs), so this `main` is only used for the desktop dev build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    blissful_tv_lib::run()
}
