use mdx_formatter_core::types::FormatterSettings;
use mdx_formatter_core::VecSink;
use napi_derive::napi;

fn resolve_settings(settings_json: Option<String>) -> napi::Result<FormatterSettings> {
    Ok(if let Some(json) = settings_json {
        let partial: serde_json::Value = serde_json::from_str(&json)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        // The TS loader ships an already-merged blob that may include the
        // four list-normalize top-level kebab-case keys. `from_public_json`
        // lifts those into `settings.list_normalize` before deserializing
        // the rest via the camelCase serde path. Calling
        // `from_partial_json` directly here silently dropped the keys (see
        // issue #88 — baseline "formatter is innocent" regression).
        mdx_formatter_core::from_public_json(&partial)
    } else {
        FormatterSettings::default()
    })
}

#[napi]
pub fn format(content: String, settings_json: Option<String>) -> napi::Result<String> {
    let settings = resolve_settings(settings_json)?;
    if settings.error_handling.throw_on_error {
        mdx_formatter_core::try_format(&content, &settings)
            .map_err(|e| napi::Error::from_reason(e))
    } else {
        Ok(mdx_formatter_core::format(&content, &settings))
    }
}

/// Compute the dry-run report for `content` and return it as a JSON string.
///
/// The JSON shape is an array of objects:
///   `{ rule: string, startLine: number, endLine: number,
///      before: string[], after: string[] }`
/// Line numbers are 0-indexed. The TS CLI converts them to 1-based when
/// printing. Parse errors are propagated as napi errors.
#[napi]
pub fn dry_run_report(
    content: String,
    settings_json: Option<String>,
) -> napi::Result<String> {
    let settings = resolve_settings(settings_json)?;
    let mut sink = VecSink::default();
    mdx_formatter_core::try_format_with_sink(&content, &settings, &mut sink)
        .map_err(|e| napi::Error::from_reason(e))?;

    let entries: Vec<serde_json::Value> = sink
        .entries
        .into_iter()
        .map(|e| {
            serde_json::json!({
                "rule": e.rule,
                "startLine": e.start_line,
                "endLine": e.end_line,
                "before": e.before,
                "after": e.after,
            })
        })
        .collect();

    serde_json::to_string(&entries).map_err(|e| napi::Error::from_reason(e.to_string()))
}
