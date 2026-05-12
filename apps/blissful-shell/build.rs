// Build script for blissful-shell.
//
// Currently does one job: tell the MSVC linker where to find `mpv.lib`
// (the import library that pairs with libmpv-2.dll). libmpv2-sys's own
// build.rs emits `cargo:rustc-link-lib=mpv` but no search path, so without
// this we'd hit `LNK1181: cannot open input file 'mpv.lib'` at link time.
//
// We point at `resources/mpv-x64/` next to this file. Drop both `mpv.lib`
// (link-time) and `libmpv-2.dll` (runtime) there per PREREQUISITES.md.
//
// If the env var `MPV_LIB_DIR` is set, it overrides the default — useful
// for CI runners that source libmpv from a different location.

use std::env;
use std::path::PathBuf;

fn main() {
    let crate_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let default_dir = crate_dir.join("resources").join("mpv-x64");
    let lib_dir = env::var("MPV_LIB_DIR")
        .map(PathBuf::from)
        .unwrap_or(default_dir);

    // Tell cargo to re-run this build script if the env var changes.
    println!("cargo:rerun-if-env-changed=MPV_LIB_DIR");
    // Or if the import library appears/disappears.
    println!(
        "cargo:rerun-if-changed={}",
        lib_dir.join("mpv.lib").display()
    );

    // Emit the link search path. If the dir doesn't exist yet, cargo still
    // accepts the directive — the linker just won't find mpv.lib and will
    // produce LNK1181, which is the clearer error of the two.
    println!("cargo:rustc-link-search=native={}", lib_dir.display());
}
