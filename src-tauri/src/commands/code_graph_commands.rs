//! Tauri commands for the code-graph diagram view.

use std::path::PathBuf;

use anyhow::Context;
use tauri::ipc::Channel;

use crate::{
    code_graph::{self, BuildProgress, CodeGraph},
    models::workspaces as workspace_models,
};

use super::common::{run_blocking, CmdResult};

#[tauri::command]
pub async fn code_graph_get(
    workspace_id: String,
    on_progress: Channel<BuildProgress>,
) -> CmdResult<CodeGraph> {
    let cached = code_graph::get_cached(&workspace_id);
    if let Some(graph) = cached {
        // Still emit a synthetic Done so the frontend's progress hook
        // resolves the same way for cache hits and cold builds.
        let _ = on_progress.send(BuildProgress::Done {
            content_revision: graph.content_revision.clone(),
        });
        return Ok(graph);
    }

    run_blocking(move || {
        let workspace_root = workspace_root_for(&workspace_id)?;
        code_graph::build_code_graph(&workspace_id, &workspace_root, Some(&on_progress))
            .with_context(|| format!("Failed to build code graph for {workspace_id}"))
    })
    .await
}

#[tauri::command]
pub async fn code_graph_invalidate(workspace_id: String) -> CmdResult<()> {
    run_blocking(move || {
        code_graph::invalidate(&workspace_id);
        Ok(())
    })
    .await
}

fn workspace_root_for(workspace_id: &str) -> anyhow::Result<PathBuf> {
    let record = workspace_models::load_workspace_record_by_id(workspace_id)?
        .with_context(|| format!("Workspace not found: {workspace_id}"))?;
    let dir = crate::data_dir::workspace_dir(&record.repo_name, &record.directory_name)?;
    Ok(dir)
}
