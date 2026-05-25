//! `helmor ngrok` — manage Debug ingest public forwarding.

use anyhow::Result;

use crate::ngrok_config::{self, NgrokConfigStatus, NgrokConfigUpdate};

use super::args::{Cli, NgrokAction, NgrokDomainAction};
use super::output;

pub fn dispatch(action: &NgrokAction, cli: &Cli) -> Result<()> {
    match action {
        NgrokAction::Status => print_status(cli),
        NgrokAction::Enable { domain } => update(
            NgrokConfigUpdate {
                enabled: Some(true),
                domain: domain.as_ref().map(|value| Some(value.clone())),
            },
            cli,
            "Enabled Debug ingest ngrok forwarding.",
        ),
        NgrokAction::Disable => {
            let status = ngrok_config::update(NgrokConfigUpdate {
                enabled: Some(false),
                domain: None,
            })?;
            let reset_sent = ngrok_config::reset_running_app_tunnels();
            print_updated(
                cli,
                &status,
                &format!(
                    "Disabled Debug ingest ngrok forwarding. Active tunnel reset sent: {}",
                    yes_no(reset_sent)
                ),
            )
        }
        NgrokAction::Domain { action } => match action {
            NgrokDomainAction::Set { domain } => update(
                NgrokConfigUpdate {
                    enabled: None,
                    domain: Some(Some(domain.clone())),
                },
                cli,
                "Updated Debug ingest ngrok domain.",
            ),
            NgrokDomainAction::Clear => update(
                NgrokConfigUpdate {
                    enabled: None,
                    domain: Some(None),
                },
                cli,
                "Cleared Debug ingest ngrok domain.",
            ),
        },
        NgrokAction::Reset => {
            let status = ngrok_config::reset()?;
            print_updated(cli, &status, "Reset Debug ingest ngrok forwarding.")
        }
    }
}

fn print_status(cli: &Cli) -> Result<()> {
    let status = ngrok_config::status()?;
    output::print(cli, &status, human_status)
}

fn update(update: NgrokConfigUpdate, cli: &Cli, message: &str) -> Result<()> {
    let status = ngrok_config::update(update)?;
    print_updated(cli, &status, message)
}

fn print_updated(cli: &Cli, status: &NgrokConfigStatus, message: &str) -> Result<()> {
    output::print(cli, status, |status| {
        format!("{message}\n\n{}", human_status(status))
    })
}

fn human_status(status: &NgrokConfigStatus) -> String {
    format!(
        "Enabled:           {}\nDomain:            {}\nNGROK_AUTHTOKEN:   {}\nRunning app:       {}",
        yes_no(status.enabled),
        status.domain.as_deref().unwrap_or("(dynamic)"),
        yes_no(status.ngrok_authtoken_present),
        yes_no(status.running_app_available),
    )
}

fn yes_no(value: bool) -> &'static str {
    if value {
        "yes"
    } else {
        "no"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn human_status_uses_dynamic_domain_when_unset() {
        let status = NgrokConfigStatus {
            enabled: true,
            domain: None,
            ngrok_authtoken_present: false,
            running_app_available: true,
        };

        let rendered = human_status(&status);
        assert!(rendered.contains("Enabled:           yes"));
        assert!(rendered.contains("Domain:            (dynamic)"));
        assert!(rendered.contains("NGROK_AUTHTOKEN:   no"));
        assert!(rendered.contains("Running app:       yes"));
    }
}
