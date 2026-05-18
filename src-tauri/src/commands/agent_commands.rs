use tauri::{AppHandle, Manager};

use crate::agents::{DelegateAgentRequest, DelegateAgentResponse};
use crate::error::CommandError;
use crate::models::delegations::DelegationRecord;

use super::common::{run_blocking, CmdResult};

#[tauri::command]
pub async fn delegate_agent(
    app: AppHandle,
    _sidecar: tauri::State<'_, crate::sidecar::ManagedSidecar>,
    request: DelegateAgentRequest,
) -> Result<DelegateAgentResponse, CommandError> {
    let app_for_blocking = app.clone();
    run_blocking(move || {
        let sidecar = app_for_blocking.state::<crate::sidecar::ManagedSidecar>();
        crate::agents::delegation::delegate_agent_blocking(
            app_for_blocking.clone(),
            sidecar.inner(),
            request,
            None,
        )
    })
    .await
}

#[tauri::command]
pub async fn list_session_delegations(
    parent_session_id: String,
) -> CmdResult<Vec<DelegationRecord>> {
    crate::models::delegations::get_delegations_for_parent_async(&parent_session_id)
        .await
        .map_err(Into::into)
}
