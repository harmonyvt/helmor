use std::fs;
use std::path::Path;
use std::time::SystemTime;

use anyhow::Context;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CrashReportSummary {
    pub(super) file_name: String,
    source_path: String,
    pub(super) exported_path: Option<String>,
    modified_at: Option<String>,
    size_bytes: u64,
    pub(super) app_name: Option<String>,
    pub(super) app_version: Option<String>,
    bundle_id: Option<String>,
    report_timestamp: Option<String>,
    capture_time: Option<String>,
    process_name: Option<String>,
    process_path: Option<String>,
    pid: Option<i64>,
    pub(super) exception_type: Option<String>,
    pub(super) signal: Option<String>,
    termination_indicator: Option<String>,
    faulting_thread: Option<i64>,
    pub(super) allocator_diagnostics: Vec<String>,
    pub(super) faulting_thread_frames: Vec<String>,
    parse_error: Option<String>,
}

impl CrashReportSummary {
    pub(super) fn parse_error(
        file_name: String,
        source_path: String,
        modified_at: Option<String>,
        size_bytes: u64,
        parse_error: String,
    ) -> Self {
        Self {
            file_name,
            source_path,
            exported_path: None,
            modified_at,
            size_bytes,
            app_name: None,
            app_version: None,
            bundle_id: None,
            report_timestamp: None,
            capture_time: None,
            process_name: None,
            process_path: None,
            pid: None,
            exception_type: None,
            signal: None,
            termination_indicator: None,
            faulting_thread: None,
            allocator_diagnostics: Vec::new(),
            faulting_thread_frames: Vec::new(),
            parse_error: Some(parse_error),
        }
    }
}

pub(super) fn summarize_crash_report(
    path: &Path,
    size_bytes: u64,
    modified: Option<SystemTime>,
) -> anyhow::Result<CrashReportSummary> {
    let contents = fs::read_to_string(path)
        .with_context(|| format!("Failed to read crash report {}", path.display()))?;
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown-crash-report".to_string());
    let (header, detail, parse_error) = parse_crash_report_values(&contents);

    Ok(CrashReportSummary {
        file_name,
        source_path: path.display().to_string(),
        exported_path: None,
        modified_at: modified.map(system_time_to_rfc3339),
        size_bytes,
        app_name: header
            .as_ref()
            .and_then(|value| value.get("app_name"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        app_version: header
            .as_ref()
            .and_then(|value| value.get("app_version"))
            .and_then(Value::as_str)
            .or_else(|| {
                detail
                    .as_ref()
                    .and_then(|value| value.pointer("/bundleInfo/CFBundleShortVersionString"))
                    .and_then(Value::as_str)
            })
            .map(ToString::to_string),
        bundle_id: header
            .as_ref()
            .and_then(|value| value.get("bundleID"))
            .and_then(Value::as_str)
            .or_else(|| {
                detail
                    .as_ref()
                    .and_then(|value| value.pointer("/bundleInfo/CFBundleIdentifier"))
                    .and_then(Value::as_str)
            })
            .map(ToString::to_string),
        report_timestamp: header
            .as_ref()
            .and_then(|value| value.get("timestamp"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        capture_time: detail
            .as_ref()
            .and_then(|value| value.get("captureTime"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        process_name: detail
            .as_ref()
            .and_then(|value| value.get("procName"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        process_path: detail
            .as_ref()
            .and_then(|value| value.get("procPath"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        pid: detail
            .as_ref()
            .and_then(|value| value.get("pid"))
            .and_then(Value::as_i64),
        exception_type: detail
            .as_ref()
            .and_then(|value| value.pointer("/exception/type"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        signal: detail
            .as_ref()
            .and_then(|value| value.pointer("/exception/signal"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        termination_indicator: detail
            .as_ref()
            .and_then(|value| value.pointer("/termination/indicator"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        faulting_thread: detail
            .as_ref()
            .and_then(|value| value.get("faultingThread"))
            .and_then(Value::as_i64),
        allocator_diagnostics: detail
            .as_ref()
            .map(extract_allocator_diagnostics)
            .unwrap_or_default(),
        faulting_thread_frames: detail
            .as_ref()
            .map(extract_faulting_thread_frames)
            .unwrap_or_default(),
        parse_error,
    })
}

fn parse_crash_report_values(contents: &str) -> (Option<Value>, Option<Value>, Option<String>) {
    let mut lines = contents.lines();
    let header = lines
        .next()
        .and_then(|line| serde_json::from_str::<Value>(line).ok());
    let detail_text = lines.collect::<Vec<_>>().join("\n");
    if detail_text.trim().is_empty() {
        return (header, None, None);
    }
    match serde_json::from_str::<Value>(&detail_text) {
        Ok(detail) => (header, Some(detail), None),
        Err(error) => (header, None, Some(error.to_string())),
    }
}

fn extract_allocator_diagnostics(detail: &Value) -> Vec<String> {
    let Some(asi) = detail.get("asi").and_then(Value::as_object) else {
        return Vec::new();
    };
    asi.values()
        .flat_map(|value| value.as_array().into_iter().flatten())
        .filter_map(Value::as_str)
        .map(ToString::to_string)
        .collect()
}

fn extract_faulting_thread_frames(detail: &Value) -> Vec<String> {
    let Some(faulting_thread) = detail.get("faultingThread").and_then(Value::as_i64) else {
        return Vec::new();
    };
    let Some(threads) = detail.get("threads").and_then(Value::as_array) else {
        return Vec::new();
    };
    let Some(thread) = threads
        .iter()
        .find(|thread| thread.get("id").and_then(Value::as_i64) == Some(faulting_thread))
    else {
        return Vec::new();
    };
    thread
        .get("frames")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(32)
        .filter_map(format_crash_frame)
        .collect()
}

fn format_crash_frame(frame: &Value) -> Option<String> {
    let symbol = frame.get("symbol").and_then(Value::as_str)?;
    let image_index = frame.get("imageIndex").and_then(Value::as_i64);
    let image_offset = frame.get("imageOffset").and_then(Value::as_i64);
    match (image_index, image_offset) {
        (Some(index), Some(offset)) => Some(format!("{symbol} (image {index}, offset {offset})")),
        _ => Some(symbol.to_string()),
    }
}

pub(super) fn system_time_to_rfc3339(time: SystemTime) -> String {
    let timestamp: chrono::DateTime<chrono::Local> = time.into();
    timestamp.to_rfc3339()
}
