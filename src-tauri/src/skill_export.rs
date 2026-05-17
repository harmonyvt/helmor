use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::Serialize;

const HELMOR_SKILL_PREFIX: &str = "helmor-";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkillTarget {
    All,
    Codex,
    Claude,
    Agents,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillExportItem {
    pub target: String,
    pub skill: String,
    pub source: PathBuf,
    pub destination: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillExportResponse {
    pub target: String,
    pub dry_run: bool,
    pub exported: Vec<SkillExportItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRuntimeStatus {
    pub codex: bool,
    pub claude: bool,
    pub agents: bool,
}

pub fn export_helmor_skills(target: SkillTarget, dry_run: bool) -> Result<SkillExportResponse> {
    export_helmor_skills_with_roots(target, dry_run, &source_roots()?, &destination_roots()?)
}

pub fn skill_runtime_status() -> SkillRuntimeStatus {
    let roots = destination_roots().unwrap_or_else(|_| SkillRoots::default());
    SkillRuntimeStatus {
        codex: contains_helmor_skill(&roots.codex),
        claude: contains_helmor_skill(&roots.claude),
        agents: contains_helmor_skill(&roots.agents),
    }
}

fn export_helmor_skills_with_roots(
    target: SkillTarget,
    dry_run: bool,
    sources: &SkillRoots,
    destinations: &SkillRoots,
) -> Result<SkillExportResponse> {
    let mut exported = Vec::new();
    for &runtime in target.runtimes() {
        let source_root = sources.for_runtime(runtime);
        if !source_root.is_dir() {
            continue;
        }
        for source in helmor_skill_dirs(source_root)? {
            let skill = source
                .file_name()
                .and_then(|name| name.to_str())
                .context("Helmor skill source has no valid UTF-8 name")?
                .to_string();
            let destination = destinations.for_runtime(runtime).join(&skill);
            if !dry_run {
                copy_skill_dir(&source, &destination)?;
            }
            exported.push(SkillExportItem {
                target: runtime.label().to_string(),
                skill,
                source,
                destination,
            });
        }
    }
    Ok(SkillExportResponse {
        target: target.label().to_string(),
        dry_run,
        exported,
    })
}

fn helmor_skill_dirs(root: &Path) -> Result<Vec<PathBuf>> {
    let mut dirs = Vec::new();
    for entry in fs::read_dir(root).with_context(|| format!("Failed to read {}", root.display()))? {
        let entry = entry?;
        let path = entry.path();
        let resolved = if path.is_symlink() {
            fs::canonicalize(&path)
                .with_context(|| format!("Failed to resolve skill symlink {}", path.display()))?
        } else {
            path
        };
        let Some(name) = resolved.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name.starts_with(HELMOR_SKILL_PREFIX) && resolved.join("SKILL.md").is_file() {
            dirs.push(resolved);
        }
    }
    dirs.sort();
    Ok(dirs)
}

fn copy_skill_dir(source: &Path, destination: &Path) -> Result<()> {
    if !source.join("SKILL.md").is_file() {
        bail!("{} is not a Helmor skill directory", source.display());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create {}", parent.display()))?;
    }
    if destination.exists() || destination.is_symlink() {
        let metadata = fs::symlink_metadata(destination)
            .with_context(|| format!("Failed to inspect {}", destination.display()))?;
        if metadata.is_dir() {
            fs::remove_dir_all(destination)
        } else {
            fs::remove_file(destination)
        }
        .with_context(|| format!("Failed to replace {}", destination.display()))?;
    }
    copy_dir_recursive(source, destination)
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)
        .with_context(|| format!("Failed to create {}", destination.display()))?;
    for entry in
        fs::read_dir(source).with_context(|| format!("Failed to read {}", source.display()))?
    {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)
            .with_context(|| format!("Failed to inspect {}", source_path.display()))?;
        if metadata.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else if metadata.file_type().is_symlink() {
            let resolved = fs::canonicalize(&source_path)
                .with_context(|| format!("Failed to resolve {}", source_path.display()))?;
            if resolved.is_dir() {
                copy_dir_recursive(&resolved, &destination_path)?;
            } else {
                fs::copy(&resolved, &destination_path).with_context(|| {
                    format!(
                        "Failed to copy {} to {}",
                        resolved.display(),
                        destination_path.display()
                    )
                })?;
            }
        } else {
            fs::copy(&source_path, &destination_path).with_context(|| {
                format!(
                    "Failed to copy {} to {}",
                    source_path.display(),
                    destination_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn source_roots() -> Result<SkillRoots> {
    if let Some(root) = std::env::var_os("HELMOR_SKILLS_SOURCE_DIR").map(PathBuf::from) {
        return Ok(SkillRoots::from_parent(root));
    }

    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .context("CARGO_MANIFEST_DIR has no parent")?;
    let repo_roots = SkillRoots {
        codex: repo_root.join(".codex/skills"),
        claude: repo_root.join(".claude/skills"),
        agents: repo_root.join(".agents/skills"),
    };
    if repo_roots.any_exists() {
        return Ok(repo_roots);
    }

    let app_resources = current_exe_resources_dir()?.join("skills");
    Ok(SkillRoots {
        codex: app_resources.join("codex"),
        claude: app_resources.join("claude"),
        agents: app_resources.join("agents"),
    })
}

fn destination_roots() -> Result<SkillRoots> {
    let home = std::env::var_os("HELMOR_SKILLS_HOME")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .context("HOME is not set")?;
    let claude_root = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".claude"));
    Ok(SkillRoots {
        codex: home.join(".codex/skills"),
        claude: claude_root.join("skills"),
        agents: home.join(".agents/skills"),
    })
}

fn current_exe_resources_dir() -> Result<PathBuf> {
    let exe = std::env::current_exe().context("Cannot determine current executable path")?;
    let macos_dir = exe
        .parent()
        .context("Current executable has no parent directory")?;
    Ok(macos_dir
        .parent()
        .map(|contents| contents.join("Resources"))
        .unwrap_or_else(|| macos_dir.join("Resources")))
}

fn contains_helmor_skill(root: &Path) -> bool {
    helmor_skill_dirs(root)
        .map(|skills| !skills.is_empty())
        .unwrap_or(false)
}

#[derive(Debug, Clone, Default)]
struct SkillRoots {
    codex: PathBuf,
    claude: PathBuf,
    agents: PathBuf,
}

impl SkillRoots {
    fn from_parent(root: PathBuf) -> Self {
        Self {
            codex: root.join("codex"),
            claude: root.join("claude"),
            agents: root.join("agents"),
        }
    }

    fn any_exists(&self) -> bool {
        self.codex.exists() || self.claude.exists() || self.agents.exists()
    }

    fn for_runtime(&self, runtime: RuntimeTarget) -> &Path {
        match runtime {
            RuntimeTarget::Codex => &self.codex,
            RuntimeTarget::Claude => &self.claude,
            RuntimeTarget::Agents => &self.agents,
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum RuntimeTarget {
    Codex,
    Claude,
    Agents,
}

impl RuntimeTarget {
    fn label(self) -> &'static str {
        match self {
            RuntimeTarget::Codex => "codex",
            RuntimeTarget::Claude => "claude",
            RuntimeTarget::Agents => "agents",
        }
    }
}

impl SkillTarget {
    fn label(self) -> &'static str {
        match self {
            SkillTarget::All => "all",
            SkillTarget::Codex => "codex",
            SkillTarget::Claude => "claude",
            SkillTarget::Agents => "agents",
        }
    }

    fn runtimes(self) -> &'static [RuntimeTarget] {
        match self {
            SkillTarget::All => &[
                RuntimeTarget::Codex,
                RuntimeTarget::Claude,
                RuntimeTarget::Agents,
            ],
            SkillTarget::Codex => &[RuntimeTarget::Codex],
            SkillTarget::Claude => &[RuntimeTarget::Claude],
            SkillTarget::Agents => &[RuntimeTarget::Agents],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_skill(root: &Path, name: &str) {
        let dir = root.join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("SKILL.md"), format!("# {name}\n")).unwrap();
    }

    #[test]
    fn dry_run_reports_all_runtime_copies_without_writing() {
        let source = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let sources = SkillRoots::from_parent(source.path().to_path_buf());
        let destinations = SkillRoots::from_parent(dest.path().to_path_buf());
        write_skill(&sources.codex, "helmor-cli");
        write_skill(&sources.claude, "helmor-app-install");
        write_skill(&sources.agents, "helmor-release");

        let result =
            export_helmor_skills_with_roots(SkillTarget::All, true, &sources, &destinations)
                .unwrap();

        assert_eq!(result.exported.len(), 3);
        assert!(!destinations.codex.join("helmor-cli").exists());
        assert!(!destinations.claude.join("helmor-app-install").exists());
        assert!(!destinations.agents.join("helmor-release").exists());
    }

    #[test]
    fn export_replaces_matching_skill_directory() {
        let source = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let sources = SkillRoots::from_parent(source.path().to_path_buf());
        let destinations = SkillRoots::from_parent(dest.path().to_path_buf());
        write_skill(&sources.codex, "helmor-cli");
        fs::create_dir_all(destinations.codex.join("helmor-cli")).unwrap();
        fs::write(destinations.codex.join("helmor-cli/old.txt"), "old").unwrap();

        let result =
            export_helmor_skills_with_roots(SkillTarget::Codex, false, &sources, &destinations)
                .unwrap();

        assert_eq!(result.exported.len(), 1);
        assert!(destinations.codex.join("helmor-cli/SKILL.md").is_file());
        assert!(!destinations.codex.join("helmor-cli/old.txt").exists());
    }
}
