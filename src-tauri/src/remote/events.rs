use std::{io::Write, net::TcpStream, time::Duration};

use anyhow::Result;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::server::RemoteServerManager;

pub(crate) fn stream_events(mut stream: TcpStream, app: AppHandle) -> Result<()> {
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
    )?;
    stream.flush()?;

    let ui_rx = app
        .state::<crate::ui_sync::UiSyncManager>()
        .subscribe_remote();
    let agent_rx = app.state::<RemoteServerManager>().subscribe_agent_events();
    write_sse(&mut stream, "ready", &json!({ "ok": true }))?;
    loop {
        while let Ok(event) = agent_rx.try_recv() {
            write_sse(
                &mut stream,
                "agentStream",
                &json!({
                    "kind": "agentStream",
                    "event": event,
                }),
            )?;
        }

        while let Ok(event) = ui_rx.try_recv() {
            write_sse(
                &mut stream,
                "uiMutation",
                &json!({
                    "kind": "uiMutation",
                    "event": event,
                }),
            )?;
        }

        match ui_rx.recv_timeout(Duration::from_millis(250)) {
            Ok(event) => {
                write_sse(
                    &mut stream,
                    "uiMutation",
                    &json!({
                        "kind": "uiMutation",
                        "event": event,
                    }),
                )?;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                write_sse(&mut stream, "heartbeat", &json!({ "ok": true }))?;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    Ok(())
}

fn write_sse(stream: &mut TcpStream, event: &str, value: &Value) -> Result<()> {
    writeln!(stream, "event: {event}")?;
    writeln!(stream, "data: {}", serde_json::to_string(value)?)?;
    writeln!(stream)?;
    stream.flush()?;
    Ok(())
}
