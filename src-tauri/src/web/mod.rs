//! Browser companion server for Helmor.
//!
//! This module intentionally exposes a Tauri-like `invoke` HTTP surface so the
//! existing React app can run in a normal browser with a small transport shim.

mod server;

pub use server::{default_frontend_dir, serve, WebServerOptions};
