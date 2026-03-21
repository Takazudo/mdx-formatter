use wasm_bindgen::prelude::*;
use mdx_formatter_core::types::FormatterSettings;

#[wasm_bindgen]
pub fn format(content: &str, settings_json: Option<String>) -> String {
    let settings = if let Some(json) = settings_json {
        let partial: serde_json::Value = serde_json::from_str(&json)
            .unwrap_or_default();
        FormatterSettings::from_partial_json(&partial)
    } else {
        FormatterSettings::default()
    };
    mdx_formatter_core::format(content, &settings)
}

#[wasm_bindgen]
pub fn format_with_defaults(content: &str) -> String {
    let settings = FormatterSettings::default();
    mdx_formatter_core::format(content, &settings)
}
