# @takazudo/mdx-formatter

AST-based markdown and MDX formatter with Japanese text support. Built on top of the unified ecosystem with remark plugins.

## Features

- **AST-based formatting** - Uses remark's AST for reliable formatting
- **MDX support** - Full support for MDX syntax including JSX components
- **Japanese text formatting** - Special handling for Japanese punctuation and URLs
- **Docusaurus support** - Preserves Docusaurus admonitions (:::note, :::tip, etc.)
- **HTML block formatting** - Proper indentation for HTML blocks (dl, table, ul, div, etc.)
- **GFM features** - Tables, strikethrough, task lists
- **Frontmatter preservation** - YAML frontmatter support
- **CLI and API** - Use as command-line tool or import as library
- **Configurable** - Customize component lists and rules via config file or API

## Installation

```bash
pnpm add @takazudo/mdx-formatter
```

Or use directly with pnpm dlx:

```bash
pnpm dlx @takazudo/mdx-formatter --write "**/*.md"
```

## Usage

### CLI

```bash
# Check files (exit with error if formatting needed)
mdx-formatter --check "**/*.{md,mdx}"

# Format files in place
mdx-formatter --write "**/*.{md,mdx}"

# Preview what would be changed (default)
mdx-formatter "**/*.{md,mdx}"

# Ignore specific patterns
mdx-formatter --write "**/*.md" --ignore "node_modules/**,dist/**"

# Use a custom config file
mdx-formatter --write "**/*.md" --config ./my-config.json
```

### API

```javascript
import { format } from '@takazudo/mdx-formatter';

// Format a string
const formatted = await format('# Hello\nWorld');
console.log(formatted); // '# Hello\n\nWorld'

// Format with custom settings
const formatted2 = await format(content, {
  settings: {
    addEmptyLinesInBlockJsx: {
      blockComponents: ['Outro', 'InfoBox'],
    },
    indentJsxContent: {
      containerComponents: ['Outro', 'InfoBox'],
    },
    formatMultiLineJsx: {
      ignoreComponents: ['CodeBlock'],
    },
  },
});
```

### Stdin

```bash
cat file.md | ./format-stdin.js > formatted.md
```

### Integration with lint-staged

Add to your `package.json`:

```json
{
  "lint-staged": {
    "*.{md,mdx}": ["mdx-formatter --write"]
  }
}
```

## Configuration

The formatter looks for configuration in three layers (later layers override earlier ones):

1. **Built-in defaults** (from `settings.mjs`)
2. **Config file** (`.mdx-formatter.json` or `"mdx-formatter"` key in `package.json`)
3. **Programmatic options** (passed to `format()`)

### Config File

Create `.mdx-formatter.json` in your project root:

```json
{
  "addEmptyLinesInBlockJsx": {
    "blockComponents": ["Outro", "InfoBox"]
  },
  "indentJsxContent": {
    "containerComponents": ["Outro", "InfoBox", "LayoutDivide"]
  },
  "formatMultiLineJsx": {
    "ignoreComponents": ["CodeBlock"]
  }
}
```

Or add an `"mdx-formatter"` key to your `package.json`:

```json
{
  "mdx-formatter": {
    "addEmptyLinesInBlockJsx": {
      "blockComponents": ["Outro", "InfoBox"]
    }
  }
}
```

## Options Reference

Every option can be set via config file or programmatic API. Each rule has an `enabled` flag that can be toggled independently.

### `addEmptyLineBetweenElements`

Add a single empty line between markdown block elements (headings, paragraphs, lists, code blocks, etc.).

| Property  | Type      | Default | Description              |
| --------- | --------- | ------- | ------------------------ |
| `enabled` | `boolean` | `true`  | Enable/disable this rule |

```json
{
  "addEmptyLineBetweenElements": {
    "enabled": true
  }
}
```

### `formatMultiLineJsx`

Format multi-line JSX/HTML components with proper indentation. Closing `/>` is appended to the last attribute line.

| Property           | Type       | Default | Description                                               |
| ------------------ | ---------- | ------- | --------------------------------------------------------- |
| `enabled`          | `boolean`  | `true`  | Enable/disable this rule                                  |
| `indentSize`       | `number`   | `2`     | Number of spaces for indentation                          |
| `ignoreComponents` | `string[]` | `[]`    | Component names to skip (preserve their formatting as-is) |

```json
{
  "formatMultiLineJsx": {
    "enabled": true,
    "indentSize": 2,
    "ignoreComponents": ["CodeBlock", "RawHTML"]
  }
}
```

### `formatHtmlBlocksInMdx`

Format HTML blocks within MDX content using Prettier. Applies to standard HTML elements like `<dl>`, `<table>`, `<div>`, `<ul>`, etc.

| Property                   | Type      | Default   | Description                                |
| -------------------------- | --------- | --------- | ------------------------------------------ |
| `enabled`                  | `boolean` | `true`    | Enable/disable this rule                   |
| `formatterConfig`          | `object`  | see below | Prettier configuration for HTML formatting |
| `formatterConfig.parser`   | `string`  | `"html"`  | Prettier parser to use                     |
| `formatterConfig.tabWidth` | `number`  | `2`       | Number of spaces per indentation level     |
| `formatterConfig.useTabs`  | `boolean` | `false`   | Use tabs instead of spaces                 |

```json
{
  "formatHtmlBlocksInMdx": {
    "enabled": true,
    "formatterConfig": {
      "parser": "html",
      "tabWidth": 4,
      "useTabs": false
    }
  }
}
```

### `expandSingleLineJsx`

Convert single-line JSX components with multiple props to multi-line format. Also respects `ignoreComponents` from `formatMultiLineJsx`.

| Property         | Type      | Default | Description                                         |
| ---------------- | --------- | ------- | --------------------------------------------------- |
| `enabled`        | `boolean` | `false` | Enable/disable this rule (disabled by default)      |
| `propsThreshold` | `number`  | `2`     | Expand if the component has this many props or more |

```json
{
  "expandSingleLineJsx": {
    "enabled": true,
    "propsThreshold": 3
  }
}
```

### `indentJsxContent`

Add indentation to content inside JSX container components. Disabled by default.

| Property              | Type       | Default | Description                                      |
| --------------------- | ---------- | ------- | ------------------------------------------------ |
| `enabled`             | `boolean`  | `false` | Enable/disable this rule                         |
| `indentSize`          | `number`   | `2`     | Number of spaces for indentation                 |
| `containerComponents` | `string[]` | `[]`    | Component names whose content should be indented |

```json
{
  "indentJsxContent": {
    "enabled": true,
    "indentSize": 2,
    "containerComponents": ["Outro", "InfoBox", "LayoutDivide"]
  }
}
```

### `addEmptyLinesInBlockJsx`

Add empty lines after opening tags and before closing tags in block JSX components for better readability.

| Property          | Type       | Default | Description                                        |
| ----------------- | ---------- | ------- | -------------------------------------------------- |
| `enabled`         | `boolean`  | `true`  | Enable/disable this rule                           |
| `blockComponents` | `string[]` | `[]`    | Component names that should have empty lines added |

```json
{
  "addEmptyLinesInBlockJsx": {
    "enabled": true,
    "blockComponents": ["Outro", "InfoBox", "Sidebar"]
  }
}
```

### `formatYamlFrontmatter`

Format YAML frontmatter using proper YAML formatting rules.

| Property       | Type      | Default | Description                             |
| -------------- | --------- | ------- | --------------------------------------- |
| `enabled`      | `boolean` | `true`  | Enable/disable this rule                |
| `indent`       | `number`  | `2`     | Number of spaces for YAML indentation   |
| `lineWidth`    | `number`  | `100`   | Maximum line width for folded strings   |
| `quotingType`  | `string`  | `"\""`  | Quote type for strings: `"\""` or `"'"` |
| `forceQuotes`  | `boolean` | `false` | Force quotes on all string values       |
| `noCompatMode` | `boolean` | `true`  | Use YAML 1.2 spec (not 1.1)             |

```json
{
  "formatYamlFrontmatter": {
    "enabled": true,
    "indent": 2,
    "lineWidth": 80,
    "quotingType": "'",
    "forceQuotes": false,
    "noCompatMode": true
  }
}
```

### `preserveAdmonitions`

Keep Docusaurus admonitions (`:::note`, `:::tip`, `:::warning`, etc.) intact during formatting.

| Property  | Type      | Default | Description              |
| --------- | --------- | ------- | ------------------------ |
| `enabled` | `boolean` | `true`  | Enable/disable this rule |

```json
{
  "preserveAdmonitions": {
    "enabled": true
  }
}
```

### `autoDetectIndent`

Automatically detect indentation style (spaces vs tabs, indent size) from the file content and apply it consistently across all formatting rules.

| Property             | Type      | Default   | Description                                                |
| -------------------- | --------- | --------- | ---------------------------------------------------------- |
| `enabled`            | `boolean` | `false`   | Enable/disable auto-detection                              |
| `fallbackIndentSize` | `number`  | `2`       | Default indent size if detection fails                     |
| `fallbackIndentType` | `string`  | `"space"` | Default indent type: `"space"` or `"tab"`                  |
| `minConfidence`      | `number`  | `0.7`     | Minimum confidence score (0-1) to use detected indentation |

```json
{
  "autoDetectIndent": {
    "enabled": true,
    "fallbackIndentSize": 2,
    "fallbackIndentType": "space",
    "minConfidence": 0.7
  }
}
```

### `errorHandling`

Configure how the formatter handles parsing errors.

| Property       | Type      | Default | Description                                                      |
| -------------- | --------- | ------- | ---------------------------------------------------------------- |
| `throwOnError` | `boolean` | `false` | If `true`, throw on errors. If `false`, return original content. |

```json
{
  "errorHandling": {
    "throwOnError": false
  }
}
```

## Full Configuration Example

```json
{
  "addEmptyLineBetweenElements": {
    "enabled": true
  },
  "formatMultiLineJsx": {
    "enabled": true,
    "indentSize": 2,
    "ignoreComponents": ["CodeBlock"]
  },
  "formatHtmlBlocksInMdx": {
    "enabled": true,
    "formatterConfig": {
      "parser": "html",
      "tabWidth": 2,
      "useTabs": false
    }
  },
  "expandSingleLineJsx": {
    "enabled": false,
    "propsThreshold": 2
  },
  "indentJsxContent": {
    "enabled": false,
    "indentSize": 2,
    "containerComponents": []
  },
  "addEmptyLinesInBlockJsx": {
    "enabled": true,
    "blockComponents": ["Outro", "InfoBox"]
  },
  "formatYamlFrontmatter": {
    "enabled": true,
    "indent": 2,
    "lineWidth": 100,
    "quotingType": "\"",
    "forceQuotes": false,
    "noCompatMode": true
  },
  "preserveAdmonitions": {
    "enabled": true
  },
  "autoDetectIndent": {
    "enabled": false,
    "fallbackIndentSize": 2,
    "fallbackIndentType": "space",
    "minConfidence": 0.7
  },
  "errorHandling": {
    "throwOnError": false
  }
}
```

## Formatting Rules

### Headings

- ATX-style headings (`#`) are used
- Blank line between different block elements

### Lists

- List markers are preserved as-is
- Proper indentation for nested lists

### Code

- Fenced code blocks with ` ``` `
- Language identifier preserved
- Content inside code blocks is not modified

### Tables

- GFM tables are supported
- Pipes are padded with spaces

### Japanese Text

- Japanese punctuation spacing is preserved
- No extra spaces around Japanese characters

### MDX/JSX

- JSX components are preserved
- Import/export statements are maintained
- Self-closing tags remain self-closing
- Multi-line JSX closing `/>` appended to last attribute line

### HTML Blocks

- HTML blocks (dl, table, div, ul, ol, form, etc.) are properly indented
- Content whitespace in dt/dd elements is trimmed
- Nested HTML structures maintain correct indentation

### Docusaurus Admonitions

Admonition directives are preserved:

```markdown
:::note[Optional Title]
Content
:::
```

## CLI Options

| Option                | Description                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `-w, --write`         | Write formatted files in place                                                                        |
| `-c, --check`         | Check if files need formatting (for CI)                                                               |
| `--config <path>`     | Path to config file                                                                                   |
| `--ignore <patterns>` | Comma-separated patterns to ignore (default: `node_modules/**,dist/**,build/**,.git/**,worktrees/**`) |

## API

### `format(content, options?)`

Format markdown/MDX content.

- `content` (`string`) - Content to format
- `options.config` (`string`) - Path to config file
- `options.settings` (`object`) - Direct settings overrides (see Options Reference above)
- Returns `Promise<string>` - Formatted content (returns original on error)

### `formatFile(filePath, options?)`

Format a file and write it back if changed.

- `filePath` (`string`) - Path to the file
- `options` - Same as `format()`
- Returns `Promise<boolean>` - `true` if file was changed

### `checkFile(filePath, options?)`

Check if a file needs formatting without modifying it.

- `filePath` (`string`) - Path to the file
- `options` - Same as `format()`
- Returns `Promise<boolean>` - `true` if file needs formatting

### `detectMdx(content)`

Check if content is likely MDX (has imports, exports, JSX components, or frontmatter).

- `content` (`string`) - Content to check
- Returns `boolean`

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

## License

MIT
