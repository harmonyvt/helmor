use tauri::AppHandle;

use crate::agents::{DelegateAgentRequest, DelegateAgentResponse};
use crate::error::CommandError;

#[tauri::command]
pub async fn delegate_agent(
    app: AppHandle,
    sidecar: tauri::State<'_, crate::sidecar::ManagedSidecar>,
    request: DelegateAgentRequest,
) -> Result<DelegateAgentResponse, CommandError> {
    crate::agents::delegation::delegate_agent_blocking(app, sidecar.inner(), request, None)
        .map_err(Into::into)
}
