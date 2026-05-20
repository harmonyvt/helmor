mod parser;

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Context;
use serde::Serialize;

use self::parser::{summarize_crash_report, system_time_to_rfc3339, CrashReportSummary};

const CRASH_REPORT_EXPORT_LIMIT: usize = 10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CrashDiagnostics {
    collected_at: String,
    diagnostic_reports_dir: Option<String>,
    environment: CrashTelemetryEnvironment,
    reports: Vec<CrashReportSummary>,
    errors: Vec<String>,
}

impl CrashDiagnostics {
    pub(crate) fn report_count(&self) -> usize {
        self.reports.len()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CrashTelemetryEnvironment {
    rust_backtrace: Option<String>,
    rust_lib_backtrace: Option<String>,
    build_mode: String,
    data_mode: String,
}

pub(crate) fn collect(export_dir: &Path, files: &mut Vec<String>) -> CrashDiagnostics {
    let mut errors = Vec::new();
    let diagnostic_reports_dir = diagnostic_reports_dir();
    let mut reports = Vec::new();

    match collect_crash_reports_from_dir(
        &diagnostic_reports_dir,
        &export_dir.join("crash-reports"),
        CRASH_REPORT_EXPORT_LIMIT,
        files,
    ) {
        Ok(collected) => reports = collected,
        Err(error) => errors.push(format!("{error:#}")),
    }

    CrashDiagnostics {
        collected_at: chrono::Local::now().to_rfc3339(),
        diagnostic_reports_dir: Some(diagnostic_reports_dir.display().to_string()),
        environment: CrashTelemetryEnvironment {
            rust_backtrace: std::env::var("RUST_BACKTRACE").ok(),
            rust_lib_backtrace: std::env::var("RUST_LIB_BACKTRACE").ok(),
            build_mode: crate::data_dir::build_mode_label().to_string(),
            data_mode: crate::data_dir::data_mode_label().to_string(),
        },
        reports,
        errors,
    }
}

fn diagnostic_reports_dir() -> PathBuf {
    home_dir()
        .join("Library")
        .join("Logs")
        .join("DiagnosticReports")
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn collect_crash_reports_from_dir(
    source_dir: &Path,
    output_dir: &Path,
    limit: usize,
    files: &mut Vec<String>,
) -> anyhow::Result<Vec<CrashReportSummary>> {
    if !source_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut candidates = Vec::new();
    for entry in fs::read_dir(source_dir).with_context(|| {
        format!(
            "Failed to read crash report directory {}",
            source_dir.display()
        )
    })? {
        let entry = entry?;
        let path = entry.path();
        if !is_helmor_crash_report(&path) {
            continue;
        }
        let metadata = entry.metadata().with_context(|| {
            format!(
                "Failed to read metadata for crash report {}",
                path.display()
            )
        })?;
        if !metadata.is_file() {
            continue;
        }
        let modified = metadata.modified().ok();
        candidates.push((path, metadata.len(), modified));
    }

    candidates.sort_by(|left, right| right.2.cmp(&left.2).then_with(|| right.0.cmp(&left.0)));
    candidates.truncate(limit);

    if !candidates.is_empty() {
        fs::create_dir_all(output_dir).with_context(|| {
            format!(
                "Failed to create crash report export directory {}",
                output_dir.display()
            )
        })?;
    }

    let mut reports = Vec::new();
    for (source_path, size_bytes, modified) in candidates {
        let file_name = source_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown-crash-report".to_string());
        let target_path = output_dir.join(&file_name);
        let mut summary = summarize_crash_report(&source_path, size_bytes, modified)
            .unwrap_or_else(|error| {
                CrashReportSummary::parse_error(
                    file_name.clone(),
                    source_path.display().to_string(),
                    modified.map(system_time_to_rfc3339),
                    size_bytes,
                    format!("{error:#}"),
                )
            });

        fs::copy(&source_path, &target_path).with_context(|| {
            format!(
                "Failed to copy crash report {} to {}",
                source_path.display(),
                target_path.display()
            )
        })?;
        summary.exported_path = Some(target_path.display().to_string());
        files.push(target_path.display().to_string());
        reports.push(summary);
    }

    Ok(reports)
}

fn is_helmor_crash_report(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let lower = file_name.to_ascii_lowercase();
    lower.starts_with("helmor-") && (lower.ends_with(".ips") || lower.ends_with(".crash"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn crash_report_collector_copies_recent_helmor_reports_with_summary() {
        let tmp = tempdir().unwrap();
        let source = tmp.path().join("DiagnosticReports");
        let output = tmp.path().join("exported").join("crash-reports");
        fs::create_dir_all(&source).unwrap();
        fs::write(
            source.join("helmor-2026-05-20-154746.ips"),
            r#"{"app_name":"helmor","timestamp":"2026-05-20 15:47:46.00 +1000","app_version":"1.5.3","bundleID":"ai.helmor.desktop"}
{
  "captureTime": "2026-05-20 15:47:24.6299 +1000",
  "pid": 20240,
  "procName": "helmor",
  "procPath": "/Applications/Helmor.app/Contents/MacOS/helmor",
  "exception": {"type": "EXC_BREAKPOINT", "signal": "SIGTRAP"},
  "termination": {"indicator": "Trace/BPT trap: 5"},
  "asi": {"libsystem_malloc.dylib": ["BUG IN CLIENT OF LIBMALLOC: corrupt tiny freelist"]},
  "faultingThread": 42,
  "threads": [
    {"id": 42, "frames": [
      {"symbol": "sqlite3MemSize", "imageIndex": 0, "imageOffset": 123},
      {"symbol": "sqlite3Close"}
    ]}
  ]
}
"#,
        )
        .unwrap();
        fs::write(source.join("other-2026-05-20-154746.ips"), "{}\n{}").unwrap();

        let mut files = Vec::new();
        let reports = collect_crash_reports_from_dir(&source, &output, 10, &mut files).unwrap();

        assert_eq!(reports.len(), 1);
        assert_eq!(files.len(), 1);
        assert_eq!(reports[0].app_name.as_deref(), Some("helmor"));
        assert_eq!(reports[0].app_version.as_deref(), Some("1.5.3"));
        assert_eq!(reports[0].exception_type.as_deref(), Some("EXC_BREAKPOINT"));
        assert_eq!(reports[0].signal.as_deref(), Some("SIGTRAP"));
        assert_eq!(
            reports[0].allocator_diagnostics,
            vec!["BUG IN CLIENT OF LIBMALLOC: corrupt tiny freelist"]
        );
        assert_eq!(
            reports[0].faulting_thread_frames,
            vec!["sqlite3MemSize (image 0, offset 123)", "sqlite3Close"]
        );
        assert!(output.join("helmor-2026-05-20-154746.ips").is_file());
    }
}
