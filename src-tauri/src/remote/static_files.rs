use std::{
    fs,
    net::TcpStream,
    path::{Component, Path, PathBuf},
};

use anyhow::{Context, Result};
use tauri::{path::BaseDirectory, AppHandle, Manager};

use super::http::write_response;

pub(crate) fn serve_static(
    stream: &mut TcpStream,
    app: &AppHandle,
    request_path: &str,
) -> Result<()> {
    let Some(root) = mobile_dist_dir(app) else {
        return write_response(
            stream,
            503,
            "Service Unavailable",
            "text/plain",
            b"Mobile app has not been built yet.",
        );
    };

    let relative = static_relative_path(request_path);
    let mut path = root.join(&relative);
    if path.is_dir() {
        path = path.join("index.html");
    }
    if !path.is_file() {
        path = root.join("index.html");
    }
    let body = fs::read(&path).with_context(|| format!("Failed to read {}", path.display()))?;
    write_response(stream, 200, "OK", mime_for(&path), &body)
}

fn mobile_dist_dir(app: &AppHandle) -> Option<PathBuf> {
    let dev_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../apps/mobile/dist");
    if dev_path.join("index.html").is_file() {
        return Some(dev_path);
    }

    app.path()
        .resolve("mobile", BaseDirectory::Resource)
        .ok()
        .filter(|path| path.join("index.html").is_file())
}

fn static_relative_path(request_path: &str) -> PathBuf {
    let trimmed = request_path.trim_start_matches('/');
    let source = if trimmed.is_empty() {
        "index.html"
    } else {
        trimmed
    };
    let mut out = PathBuf::new();
    for component in Path::new(source).components() {
        if let Component::Normal(value) = component {
            out.push(value);
        }
    }
    out
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
    {
        "css" => "text/css",
        "js" => "text/javascript",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        _ => "text/html",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_path_ignores_parent_components() {
        assert_eq!(
            static_relative_path("/assets/../index.html"),
            PathBuf::from("assets/index.html")
        );
    }
}
