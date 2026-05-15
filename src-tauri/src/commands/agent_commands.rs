use tauri::AppHandle;

use crate::agents::{DelegateAgentRequest, DelegateAgentResponse};
use crate::error::CommandError;
use crate::models::delegations::DelegationRecord;

#[tauri::command]
pub async fn delegate_agent(
    app: AppHandle,
    sidecar: tauri::State<'_, crate::sidecar::ManagedSidecar>,
    request: DelegateAgentRequest,
) -> Result<DelegateAgentResponse, CommandError> {
    crate::agents::delegation::delegate_agent_blocking(app, sidecar.inner(), request, None)
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_session_delegations(
    parent_session_id: String,
) -> Result<Vec<DelegationRecord>, CommandError> {
    crate::models::delegations::get_delegations_for_parent(&parent_session_id).map_err(Into::into)
}
