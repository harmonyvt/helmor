use tauri::ipc::Channel;
use tauri::State;

use crate::debug_ingest::{
    DebugIngestEntry, DebugIngestEvent, DebugIngestManager, DebugIngestStatus,
};

use super::common::CmdResult;

#[tauri::command]
pub async fn ensure_debug_ingest_server(
    manager: State<'_, DebugIngestManager>,
    workspace_id: String,
) -> CmdResult<DebugIngestStatus> {
    Ok(manager.ensure(&workspace_id).await?)
}

#[tauri::command]
pub async fn stop_debug_ingest_server(
    manager: State<'_, DebugIngestManager>,
    workspace_id: String,
) -> CmdResult<()> {
    manager.stop(&workspace_id);
    Ok(())
}

#[tauri::command]
pub async fn read_debug_ingest_entries(
    manager: State<'_, DebugIngestManager>,
    workspace_id: String,
) -> CmdResult<Vec<DebugIngestEntry>> {
    Ok(manager.entries(&workspace_id))
}

#[tauri::command]
pub async fn clear_debug_ingest_entries(
    manager: State<'_, DebugIngestManager>,
    workspace_id: String,
) -> CmdResult<()> {
    manager.clear(&workspace_id);
    Ok(())
}

#[tauri::command]
pub async fn subscribe_debug_ingest(
    manager: State<'_, DebugIngestManager>,
    workspace_id: String,
    channel: Channel<DebugIngestEvent>,
) -> CmdResult<DebugIngestStatus> {
    let status = manager.ensure(&workspace_id).await?;
    Ok(manager.subscribe(&workspace_id, channel).unwrap_or(status))
}
