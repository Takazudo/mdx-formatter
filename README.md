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
npm install @takazudo/mdx-formatter
```

Or use directly with npx:

```bash
npx @takazudo/mdx-formatter --write "**/*.md"
```

## Usage

### CLI

```bash
# Check files (exit with error if formatting needed)
mdx-formatter --check "**/*.{md,mdx}"

# Format files in place
mdx-formatter --write "**/*.{md,mdx}"
```

### API

```javascript
import { format } from '@takazudo/mdx-formatter';

const formatted = await format('# Hello\nWorld');
console.log(formatted); // '# Hello\n\nWorld'
```

## Documentation

For full documentation including configuration, options reference, formatting rules, and API reference, visit the [documentation site](https://takazudo.github.io/mdx-formatter/).

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
