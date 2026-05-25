mod events;
mod manager;
mod socket;

use tauri::{ipc::Channel, AppHandle, Manager, Runtime};

pub use events::{UiMutationEnvelope, UiMutationEvent};
pub use manager::UiSyncManager;
pub use socket::{is_listener_running, notify_running_app, socket_path, start_listener};

pub fn publish<R: Runtime>(app: &AppHandle<R>, event: UiMutationEvent) {
    // Side-effect: invalidate the in-memory code-graph cache when the
    // working tree or HEAD changed, then emit a follow-up
    // `WorkspaceCodeGraphChanged` so the diagram view refetches. This
    // sits inside the existing publish chokepoint so individual feature
    // call sites don't need to know about the code-graph cache.
    let mut follow_up: Option<UiMutationEvent> = None;
    match &event {
        UiMutationEvent::WorkspaceGitStateChanged { workspace_id }
        | UiMutationEvent::WorkspaceFilesChanged { workspace_id } => {
            crate::code_graph::invalidate(workspace_id);
            follow_up = Some(UiMutationEvent::WorkspaceCodeGraphChanged {
                workspace_id: workspace_id.clone(),
            });
        }
        UiMutationEvent::WorkspaceChanged { workspace_id } => {
            // Branch switch / archive — drop the cache so the next
            // diagram fetch reflects the new tree.
            crate::code_graph::invalidate(workspace_id);
            follow_up = Some(UiMutationEvent::WorkspaceCodeGraphChanged {
                workspace_id: workspace_id.clone(),
            });
        }
        _ => {}
    }

    let manager = app.state::<UiSyncManager>();
    manager.publish(event);
    if let Some(follow_up) = follow_up {
        manager.publish(follow_up);
    }
}

#[tauri::command]
pub fn subscribe_ui_mutations(
    manager: tauri::State<'_, UiSyncManager>,
    on_event: Channel<UiMutationEvent>,
) {
    manager.subscribe(on_event);
}
