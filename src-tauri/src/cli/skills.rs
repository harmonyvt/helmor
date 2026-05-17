//! `helmor skills` - install bundled Helmor agent skills from the repo/app.

use anyhow::Result;

use super::args::{Cli, SkillExportTarget, SkillsAction};
use super::output;
use crate::skill_export::{self, SkillTarget};

pub fn dispatch(action: &SkillsAction, cli: &Cli) -> Result<()> {
    match action {
        SkillsAction::Export { target, dry_run } => export(*target, *dry_run, cli),
    }
}

fn export(target: SkillExportTarget, dry_run: bool, cli: &Cli) -> Result<()> {
    let response = skill_export::export_helmor_skills(target.into(), dry_run)?;
    output::print(cli, &response, |result| {
        if result.exported.is_empty() {
            "No Helmor skills found to export.".to_string()
        } else {
            let verb = if result.dry_run {
                "Would export"
            } else {
                "Exported"
            };
            let lines = result
                .exported
                .iter()
                .map(|item| {
                    format!(
                        "{}\t{}\t{}",
                        item.target,
                        item.skill,
                        item.destination.display()
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            format!(
                "{verb} {} Helmor skill copies:\n{lines}",
                result.exported.len()
            )
        }
    })
}

impl From<SkillExportTarget> for SkillTarget {
    fn from(value: SkillExportTarget) -> Self {
        match value {
            SkillExportTarget::All => SkillTarget::All,
            SkillExportTarget::Codex => SkillTarget::Codex,
            SkillExportTarget::Claude => SkillTarget::Claude,
            SkillExportTarget::Agents => SkillTarget::Agents,
        }
    }
}
