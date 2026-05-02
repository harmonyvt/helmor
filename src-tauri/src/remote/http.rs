use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::TcpStream,
    time::Duration,
};

use anyhow::{Context, Result};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{
    api::handle_api, config::RemoteAccessConfig, events::stream_events, static_files::serve_static,
};

#[derive(Debug)]
pub(crate) struct HttpRequest {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

pub(crate) fn handle_connection(
    mut stream: TcpStream,
    app: AppHandle,
    config: RemoteAccessConfig,
) -> Result<()> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .context("Failed to configure remote request timeout")?;
    let request = read_request(&mut stream)?;

    if request.method == "OPTIONS" {
        return write_response(&mut stream, 204, "No Content", "text/plain", b"");
    }

    if request.path == "/events" {
        if !is_authorized(&request.headers, &config.token) {
            return write_json(&mut stream, 401, json!({ "error": "unauthorized" }));
        }
        return stream_events(stream, app);
    }

    if request.path.starts_with("/api/") {
        if !is_authorized(&request.headers, &config.token) {
            return write_json(&mut stream, 401, json!({ "error": "unauthorized" }));
        }
        let response = handle_api(request, app, &config);
        return match response {
            Ok(value) => write_json(&mut stream, 200, value),
            Err(error) => write_json(&mut stream, 500, json!({ "error": format!("{error:#}") })),
        };
    }

    serve_static(&mut stream, &app, &request.path)
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest> {
    let mut reader = BufReader::new(stream);
    let mut first_line = String::new();
    reader
        .read_line(&mut first_line)
        .context("Failed to read request line")?;
    let mut first_parts = first_line.split_whitespace();
    let method = first_parts.next().unwrap_or_default().to_string();
    let raw_path = first_parts.next().unwrap_or("/").to_string();
    let path = raw_path
        .split_once('?')
        .map(|(path, _)| path)
        .unwrap_or(raw_path.as_str())
        .to_string();

    let mut headers = HashMap::new();
    loop {
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .context("Failed to read request header")?;
        if line == "\r\n" || line == "\n" || line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = vec![0; content_length];
    if content_length > 0 {
        reader
            .read_exact(&mut body)
            .context("Failed to read request body")?;
    }

    Ok(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn is_authorized(headers: &HashMap<String, String>, token: &str) -> bool {
    headers
        .get("authorization")
        .and_then(|value| value.strip_prefix("Bearer "))
        .is_some_and(|candidate| candidate == token)
}

pub(crate) fn write_json(stream: &mut TcpStream, status: u16, value: Value) -> Result<()> {
    let body = serde_json::to_vec(&value)?;
    write_response(
        stream,
        status,
        status_text(status),
        "application/json",
        &body,
    )
}

pub(crate) fn write_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: &str,
    body: &[u8],
) -> Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: authorization, content-type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(body)?;
    stream.flush()?;
    Ok(())
}

fn status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        401 => "Unauthorized",
        404 => "Not Found",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "OK",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorization_requires_exact_bearer_token() {
        let mut headers = HashMap::new();
        assert!(!is_authorized(&headers, "abc"));

        headers.insert("authorization".to_string(), "Bearer wrong".to_string());
        assert!(!is_authorized(&headers, "abc"));

        headers.insert("authorization".to_string(), "Bearer abc".to_string());
        assert!(is_authorized(&headers, "abc"));
    }
}
