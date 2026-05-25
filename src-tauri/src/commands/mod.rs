pub(crate) mod agent_commands;
pub(crate) mod app_install_commands;
pub(crate) mod browser_commands;
pub(crate) mod code_graph_commands;
mod common;
pub(crate) mod conductor_commands;
mod crash_diagnostics;
pub(crate) mod debug_ingest_commands;
pub(crate) mod editor_commands;
pub(crate) mod editors;
pub(crate) mod forge_commands;
pub(crate) mod github_commands;
pub(crate) mod goal_commands;
pub(crate) mod knowledge_commands;
pub(crate) mod repository_commands;
pub(crate) mod script_commands;
pub(crate) mod session_commands;
pub(crate) mod settings_commands;
pub(crate) mod system_commands;
pub(crate) mod terminal_commands;
pub(crate) mod workspace_commands;

pub use system_commands::DataInfo;

#[cfg(test)]
mod tests;
