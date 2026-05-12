pub mod mpv;
pub mod mpv_events;

pub use mpv::Player;
pub use mpv_events::OwnedMpvEvent;

use std::cell::RefCell;

// Phase 0a-only: thread-local handle so the WebView2 message callback can
// poke the player without us threading state through every closure.
// Phase 1 replaces this with a proper IPC dispatcher running on the UI
// thread that maps JSON commands to player methods.
thread_local! {
    pub static PLAYER: RefCell<Option<Player>> = RefCell::new(None);
}
