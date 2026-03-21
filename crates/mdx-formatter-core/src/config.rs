//! Configuration loading for mdx-formatter (Rust port of load-config.ts)
//!
//! Loads and merges settings from three layers:
//! 1. Built-in defaults (from `FormatterSettings::default()`)
//! 2. Config file (`.mdx-formatter.json` or `"mdx-formatter"` key in `package.json`)
//! 3. Programmatic options (passed by caller)

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::types::FormatterSettings;

/// Result of loading full config — settings plus CLI-level exclude patterns.
#[derive(Debug, Clone)]
pub struct FullConfig {
    pub settings: FormatterSettings,
    pub exclude_patterns: Vec<String>,
}

/// Deep merge two JSON objects. Objects are recursively merged; arrays and
/// scalars in `source` replace those in `target`.
fn deep_merge_json(target: &Value, source: &Value) -> Value {
    match (target, source) {
        (Value::Object(t), Value::Object(s)) => {
            let mut merged = t.clone();
            for (key, src_val) in s {
                let merged_val = if let Some(tgt_val) = merged.get(key) {
                    deep_merge_json(tgt_val, src_val)
                } else {
                    src_val.clone()
                };
                merged.insert(key.clone(), merged_val);
            }
            Value::Object(merged)
        }
        // Non-object values: source wins
        (_, s) => s.clone(),
    }
}

/// Try to find and read a config file, searching from `base_dir`.
///
/// Search order:
/// 1. If explicit path given, use it (resolved relative to base_dir)
/// 2. Try `.mdx-formatter.json` in base_dir
/// 3. Try `"mdx-formatter"` key in `package.json` in base_dir
fn find_config_file(config_path: Option<&str>, base_dir: &Path) -> Option<Value> {
    // Explicit path
    if let Some(path) = config_path {
        let resolved = if Path::new(path).is_absolute() {
            PathBuf::from(path)
        } else {
            base_dir.join(path)
        };
        return fs::read_to_string(resolved)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok());
    }

    // Try .mdx-formatter.json in base_dir
    if let Ok(content) = fs::read_to_string(base_dir.join(".mdx-formatter.json")) {
        if let Ok(val) = serde_json::from_str::<Value>(&content) {
            return Some(val);
        }
    }

    // Try "mdx-formatter" key in package.json
    if let Ok(content) = fs::read_to_string(base_dir.join("package.json")) {
        if let Ok(pkg) = serde_json::from_str::<Value>(&content) {
            if let Some(config) = pkg.get("mdx-formatter") {
                if config.is_object() {
                    return Some(config.clone());
                }
            }
        }
    }

    None
}

/// Load config file once and return both formatter settings and exclude patterns.
///
/// Three-layer merge: defaults → config file → programmatic overrides.
/// The `programmatic` parameter allows callers to pass additional overrides.
/// Searches for config files starting from the current working directory.
pub fn load_full_config(config_path: Option<&str>, programmatic: Option<&Value>) -> FullConfig {
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    load_full_config_from(&cwd, config_path, programmatic)
}

/// Like `load_full_config`, but searches from a specific base directory.
pub fn load_full_config_from(
    base_dir: &Path,
    config_path: Option<&str>,
    programmatic: Option<&Value>,
) -> FullConfig {
    // Layer 1: defaults as JSON
    let defaults = serde_json::to_value(FormatterSettings::default())
        .expect("FormatterSettings::default() must serialize to JSON");

    // Layer 2: config file
    let file_config = find_config_file(config_path, base_dir);

    let mut exclude_patterns = Vec::new();
    let after_file = if let Some(ref fc) = file_config {
        // Extract exclude patterns (CLI concern, not formatter settings)
        if let Some(Value::Array(arr)) = fc.get("exclude") {
            for item in arr {
                if let Value::String(s) = item {
                    exclude_patterns.push(s.clone());
                }
            }
        }

        // Remove "exclude" before merging into formatter settings
        let mut formatter_config = fc.clone();
        if let Value::Object(ref mut map) = formatter_config {
            map.remove("exclude");
        }

        deep_merge_json(&defaults, &formatter_config)
    } else {
        defaults
    };

    // Layer 3: programmatic overrides
    let final_json = if let Some(overrides) = programmatic {
        deep_merge_json(&after_file, overrides)
    } else {
        after_file
    };

    let settings = FormatterSettings::from_partial_json(&final_json);

    FullConfig {
        settings,
        exclude_patterns,
    }
}

/// Load and merge all configuration layers, returning just the settings.
pub fn load_config(config_path: Option<&str>, programmatic: Option<&Value>) -> FormatterSettings {
    load_full_config(config_path, programmatic).settings
}

/// Load exclude patterns from config file.
pub fn load_exclude_patterns(config_path: Option<&str>) -> Vec<String> {
    load_full_config(config_path, None).exclude_patterns
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── deep_merge_json tests ──

    #[test]
    fn deep_merge_json_scalar_override() {
        let target = json!({"a": 1, "b": 2});
        let source = json!({"b": 99});
        let result = deep_merge_json(&target, &source);
        assert_eq!(result, json!({"a": 1, "b": 99}));
    }

    #[test]
    fn deep_merge_json_nested_objects() {
        let target = json!({"outer": {"a": 1, "b": 2}});
        let source = json!({"outer": {"b": 99, "c": 3}});
        let result = deep_merge_json(&target, &source);
        assert_eq!(result, json!({"outer": {"a": 1, "b": 99, "c": 3}}));
    }

    #[test]
    fn deep_merge_json_array_replacement() {
        let target = json!({"items": [1, 2, 3]});
        let source = json!({"items": [4, 5]});
        let result = deep_merge_json(&target, &source);
        assert_eq!(result, json!({"items": [4, 5]}));
    }

    #[test]
    fn deep_merge_json_add_new_keys() {
        let target = json!({"a": 1});
        let source = json!({"b": 2});
        let result = deep_merge_json(&target, &source);
        assert_eq!(result, json!({"a": 1, "b": 2}));
    }

    #[test]
    fn deep_merge_json_deeply_nested() {
        let target = json!({"l1": {"l2": {"l3": {"a": 1, "b": 2}}}});
        let source = json!({"l1": {"l2": {"l3": {"b": 99}}}});
        let result = deep_merge_json(&target, &source);
        assert_eq!(result, json!({"l1": {"l2": {"l3": {"a": 1, "b": 99}}}}));
    }

    #[test]
    fn deep_merge_json_empty_source() {
        let target = json!({"a": 1, "b": 2});
        let source = json!({});
        let result = deep_merge_json(&target, &source);
        assert_eq!(result, json!({"a": 1, "b": 2}));
    }

    #[test]
    fn deep_merge_json_source_replaces_object_with_scalar() {
        let target = json!({"a": {"nested": 1}});
        let source = json!({"a": "replaced"});
        let result = deep_merge_json(&target, &source);
        assert_eq!(result, json!({"a": "replaced"}));
    }

    // ── find_config_file tests (using temp dirs) ──

    #[test]
    fn find_config_explicit_path() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("custom.json");
        fs::write(
            &config_path,
            r#"{"formatMultiLineJsx": {"indentSize": 4}}"#,
        )
        .unwrap();

        let result = find_config_file(Some(config_path.to_str().unwrap()), dir.path());
        assert!(result.is_some());
        assert_eq!(result.unwrap()["formatMultiLineJsx"]["indentSize"], 4);
    }

    #[test]
    fn find_config_explicit_path_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let result = find_config_file(Some("/nonexistent/path.json"), dir.path());
        assert!(result.is_none());
    }

    #[test]
    fn find_config_mdx_formatter_json() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(".mdx-formatter.json"),
            r#"{"formatMultiLineJsx": {"indentSize": 8}}"#,
        )
        .unwrap();

        let result = find_config_file(None, dir.path());
        assert!(result.is_some());
        assert_eq!(result.unwrap()["formatMultiLineJsx"]["indentSize"], 8);
    }

    #[test]
    fn find_config_package_json_key() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("package.json"),
            r#"{"name": "test", "mdx-formatter": {"expandSingleLineJsx": {"enabled": true}}}"#,
        )
        .unwrap();

        let result = find_config_file(None, dir.path());
        assert!(result.is_some());
        assert_eq!(result.unwrap()["expandSingleLineJsx"]["enabled"], true);
    }

    #[test]
    fn find_config_package_json_no_key() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("package.json"), r#"{"name": "test"}"#).unwrap();

        let result = find_config_file(None, dir.path());
        assert!(result.is_none());
    }

    #[test]
    fn find_config_prefers_mdx_formatter_json_over_package_json() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(".mdx-formatter.json"),
            r#"{"formatMultiLineJsx": {"indentSize": 4}}"#,
        )
        .unwrap();
        fs::write(
            dir.path().join("package.json"),
            r#"{"mdx-formatter": {"formatMultiLineJsx": {"indentSize": 8}}}"#,
        )
        .unwrap();

        let result = find_config_file(None, dir.path());
        // .mdx-formatter.json should win
        assert_eq!(result.unwrap()["formatMultiLineJsx"]["indentSize"], 4);
    }

    #[test]
    fn find_config_no_files_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let result = find_config_file(None, dir.path());
        assert!(result.is_none());
    }

    #[test]
    fn find_config_relative_explicit_path() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("my-config.json"),
            r#"{"formatMultiLineJsx": {"indentSize": 3}}"#,
        )
        .unwrap();

        let result = find_config_file(Some("my-config.json"), dir.path());
        assert!(result.is_some());
        assert_eq!(result.unwrap()["formatMultiLineJsx"]["indentSize"], 3);
    }

    // ── load_full_config_from tests ──

    #[test]
    fn load_full_config_defaults_when_no_config() {
        let dir = tempfile::tempdir().unwrap();
        let config = load_full_config_from(dir.path(), None, None);

        let defaults = FormatterSettings::default();
        assert_eq!(
            config.settings.format_multi_line_jsx.indent_size,
            defaults.format_multi_line_jsx.indent_size
        );
        assert!(config.exclude_patterns.is_empty());
    }

    #[test]
    fn load_full_config_merges_file_config() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.json");
        fs::write(
            &config_path,
            r#"{"formatMultiLineJsx": {"indentSize": 4}}"#,
        )
        .unwrap();

        let config =
            load_full_config_from(dir.path(), Some(config_path.to_str().unwrap()), None);

        assert_eq!(config.settings.format_multi_line_jsx.indent_size, 4);
        // Other defaults preserved
        assert!(config.settings.format_multi_line_jsx.enabled);
        assert!(config.settings.add_empty_line_between_elements.enabled);
    }

    #[test]
    fn load_full_config_extracts_exclude_patterns() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.json");
        fs::write(
            &config_path,
            r#"{"exclude": ["node_modules/**", "dist/**"], "formatMultiLineJsx": {"indentSize": 4}}"#,
        )
        .unwrap();

        let config =
            load_full_config_from(dir.path(), Some(config_path.to_str().unwrap()), None);

        assert_eq!(config.exclude_patterns, vec!["node_modules/**", "dist/**"]);
        assert_eq!(config.settings.format_multi_line_jsx.indent_size, 4);
    }

    #[test]
    fn load_full_config_exclude_filters_non_strings() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.json");
        fs::write(
            &config_path,
            r#"{"exclude": ["valid", 123, null, "also-valid"]}"#,
        )
        .unwrap();

        let config =
            load_full_config_from(dir.path(), Some(config_path.to_str().unwrap()), None);
        assert_eq!(config.exclude_patterns, vec!["valid", "also-valid"]);
    }

    #[test]
    fn load_full_config_programmatic_overrides() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.json");
        fs::write(
            &config_path,
            r#"{"formatMultiLineJsx": {"indentSize": 4}}"#,
        )
        .unwrap();

        let overrides = json!({"formatMultiLineJsx": {"indentSize": 8}});
        let config = load_full_config_from(
            dir.path(),
            Some(config_path.to_str().unwrap()),
            Some(&overrides),
        );

        assert_eq!(config.settings.format_multi_line_jsx.indent_size, 8);
    }

    #[test]
    fn load_full_config_three_layer_merge() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.json");
        fs::write(
            &config_path,
            r#"{
                "formatMultiLineJsx": {"indentSize": 4},
                "expandSingleLineJsx": {"enabled": true, "propsThreshold": 5}
            }"#,
        )
        .unwrap();

        let overrides = json!({"formatMultiLineJsx": {"indentSize": 10}});
        let config = load_full_config_from(
            dir.path(),
            Some(config_path.to_str().unwrap()),
            Some(&overrides),
        );

        // Programmatic wins for indent_size
        assert_eq!(config.settings.format_multi_line_jsx.indent_size, 10);
        // File config wins for expand (not in programmatic)
        assert!(config.settings.expand_single_line_jsx.enabled);
        assert_eq!(config.settings.expand_single_line_jsx.props_threshold, 5);
        // Default wins for everything else
        assert!(config.settings.add_empty_line_between_elements.enabled);
    }

    #[test]
    fn load_full_config_auto_discover_mdx_formatter_json() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(".mdx-formatter.json"),
            r#"{"formatMultiLineJsx": {"indentSize": 7}}"#,
        )
        .unwrap();

        let config = load_full_config_from(dir.path(), None, None);
        assert_eq!(config.settings.format_multi_line_jsx.indent_size, 7);
    }

    #[test]
    fn load_full_config_auto_discover_package_json() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("package.json"),
            r#"{"name": "test", "mdx-formatter": {"formatMultiLineJsx": {"indentSize": 9}}}"#,
        )
        .unwrap();

        let config = load_full_config_from(dir.path(), None, None);
        assert_eq!(config.settings.format_multi_line_jsx.indent_size, 9);
    }

    // ── convenience function tests ──

    #[test]
    fn load_config_returns_settings() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.json");
        fs::write(&config_path, r#"{"formatMultiLineJsx": {"indentSize": 6}}"#).unwrap();

        let settings = load_config(Some(config_path.to_str().unwrap()), None);
        assert_eq!(settings.format_multi_line_jsx.indent_size, 6);
    }

    #[test]
    fn load_exclude_patterns_returns_patterns() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.json");
        fs::write(&config_path, r#"{"exclude": ["*.tmp"]}"#).unwrap();

        let patterns = load_exclude_patterns(Some(config_path.to_str().unwrap()));
        assert_eq!(patterns, vec!["*.tmp"]);
    }

    #[test]
    fn load_config_with_array_fields() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.json");
        fs::write(
            &config_path,
            r#"{
                "indentJsxContent": {
                    "enabled": true,
                    "containerComponents": ["Tabs", "TabItem"]
                },
                "addEmptyLinesInBlockJsx": {
                    "blockComponents": ["Details", "Summary"]
                }
            }"#,
        )
        .unwrap();

        let settings = load_config(Some(config_path.to_str().unwrap()), None);
        assert!(settings.indent_jsx_content.enabled);
        assert_eq!(
            settings.indent_jsx_content.container_components,
            vec!["Tabs", "TabItem"]
        );
        assert_eq!(
            settings.add_empty_lines_in_block_jsx.block_components,
            vec!["Details", "Summary"]
        );
    }

    #[test]
    fn load_full_config_exclude_not_leaked_into_settings() {
        let dir = tempfile::tempdir().unwrap();
        let config_path = dir.path().join("config.json");
        fs::write(
            &config_path,
            r#"{"exclude": ["*.tmp"], "formatMultiLineJsx": {"indentSize": 3}}"#,
        )
        .unwrap();

        let config =
            load_full_config_from(dir.path(), Some(config_path.to_str().unwrap()), None);
        assert_eq!(config.exclude_patterns, vec!["*.tmp"]);
        assert_eq!(config.settings.format_multi_line_jsx.indent_size, 3);
        // "exclude" should not cause deserialization issues
        assert!(config.settings.add_empty_line_between_elements.enabled);
    }
}
