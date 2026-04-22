pub mod config;
pub mod formatter;
pub mod html_formatter;
pub mod parser;
pub mod types;

pub use config::{load_config, load_exclude_patterns, load_full_config, load_full_config_from, FullConfig};
pub use formatter::{
    format, format_with_sink, try_format, try_format_with_sink, NullSink, ReportEntry, ReportSink,
    VecSink,
};
pub use html_formatter::format_html_block;
pub use types::FormatterSettings;
