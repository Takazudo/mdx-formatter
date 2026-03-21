use mdx_formatter_core::types::FormatterSettings;
use napi_derive::napi;

#[napi]
pub fn format(content: String, settings_json: Option<String>) -> napi::Result<String> {
    let settings = if let Some(json) = settings_json {
        let partial: serde_json::Value = serde_json::from_str(&json)
            .map_err(|e| napi::Error::from_reason(e.to_string()))?;
        FormatterSettings::from_partial_json(&partial)
    } else {
        FormatterSettings::default()
    };

    if settings.error_handling.throw_on_error {
        mdx_formatter_core::try_format(&content, &settings)
            .map_err(|e| napi::Error::from_reason(e))
    } else {
        Ok(mdx_formatter_core::format(&content, &settings))
    }
}
