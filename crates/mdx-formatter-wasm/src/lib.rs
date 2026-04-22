use wasm_bindgen::prelude::*;
use mdx_formatter_core::types::FormatterSettings;

#[wasm_bindgen]
pub fn format(content: &str, settings_json: Option<String>) -> String {
    let mut settings = if let Some(json) = settings_json {
        let partial: serde_json::Value = serde_json::from_str(&json)
            .unwrap_or_default();
        // Honor the four list-normalize top-level kebab-case keys. See
        // `from_public_json` doc in mdx-formatter-core (issue #88).
        mdx_formatter_core::from_public_json(&partial)
    } else {
        FormatterSettings::default()
    };
    // Force throwOnError off in WASM — panic! causes an unrecoverable trap
    settings.error_handling.throw_on_error = false;
    mdx_formatter_core::format(content, &settings)
}

#[wasm_bindgen]
pub fn format_with_defaults(content: &str) -> String {
    let settings = FormatterSettings::default();
    mdx_formatter_core::format(content, &settings)
}
