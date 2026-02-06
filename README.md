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

## Configuration

The formatter looks for configuration in three layers (later layers override earlier ones):

1. Built-in defaults (empty component arrays)
2. Config file (`.mdx-formatter.json` or `"mdx-formatter"` key in `package.json`)
3. Programmatic options (passed to `format()`)

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

## CLI Options

- `-w, --write` - Write formatted files in place
- `-c, --check` - Check if files need formatting (for CI)
- `--config <path>` - Path to config file
- `--ignore <patterns>` - Comma-separated patterns to ignore (default: `node_modules/**,dist/**,build/**,.git/**,worktrees/**`)

## API Options

```javascript
await format(content, {
  config: './custom-config.json', // Path to config file
  settings: {
    // Direct settings overrides
    addEmptyLinesInBlockJsx: {
      blockComponents: ['MyComponent'],
    },
  },
});
```

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
