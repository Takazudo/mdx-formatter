import { type ReactNode, useCallback, useState } from 'react';
import { format } from '@takazudo/mdx-formatter/browser';

const SAMPLE_INPUT = `---
title: Example Document
description: Sample markdown for the formatter playground
---

#   Heading with extra spaces

Some paragraph text here.
Another paragraph without proper spacing.
## Subheading

-  List item one
-  List item two
  - Nested item

> A blockquote
> with multiple lines

| Column A | Column B |
|---|---|
| Cell 1 | Cell 2 |

<Callout type="info">
This is a JSX component in MDX.
</Callout>

Some text with a [link](https://example.com) and **bold** content.
`;

type Version = 'typescript' | 'rust';

export default function FormatterPlayground(): ReactNode {
  const [input, setInput] = useState(SAMPLE_INPUT);
  const [output, setOutput] = useState('');
  const [version, setVersion] = useState<Version>('typescript');
  const [isFormatting, setIsFormatting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFormat = useCallback(async () => {
    setIsFormatting(true);
    setError(null);
    try {
      const result = await format(input);
      setOutput(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An unexpected error occurred');
    } finally {
      setIsFormatting(false);
    }
  }, [input]);

  return (
    <div className="flex flex-col gap-vsp-sm">
      {/* Version toggle */}
      <div className="flex items-center gap-hsp-md">
        <span className="text-caption font-semibold text-muted">Engine:</span>
        <div className="flex gap-hsp-xs">
          <button
            type="button"
            onClick={() => setVersion('typescript')}
            className={`rounded px-hsp-md py-hsp-2xs text-caption font-medium transition-colors ${
              version === 'typescript'
                ? 'bg-accent text-bg'
                : 'bg-surface text-muted hover:text-fg'
            }`}
          >
            TypeScript
          </button>
          <button
            type="button"
            disabled
            className="group relative rounded px-hsp-md py-hsp-2xs text-caption font-medium bg-surface text-muted cursor-not-allowed opacity-50"
            title="Coming soon — requires WASM build"
          >
            Rust (WASM)
            <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-p0 px-hsp-sm py-hsp-2xs text-caption text-p7 opacity-0 group-hover:opacity-100 transition-opacity">
              Coming soon — requires WASM build
            </span>
          </button>
        </div>
      </div>

      {/* Textareas */}
      <div className="grid grid-cols-1 gap-hsp-md lg:grid-cols-2">
        <div className="flex flex-col gap-vsp-2xs">
          <label htmlFor="pg-input" className="text-caption font-semibold text-muted">
            Input
          </label>
          <textarea
            id="pg-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            className="min-h-80 w-full resize-y rounded-lg border border-muted/30 bg-code-bg p-hsp-md font-mono text-caption leading-relaxed text-code-fg focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-vsp-2xs">
          <label htmlFor="pg-output" className="text-caption font-semibold text-muted">
            Output
          </label>
          <textarea
            id="pg-output"
            value={output}
            readOnly
            spellCheck={false}
            className="min-h-80 w-full resize-y rounded-lg border border-muted/30 bg-code-bg p-hsp-md font-mono text-caption leading-relaxed text-code-fg focus:border-accent focus:outline-none"
            placeholder="Click Format to see the result..."
          />
        </div>
      </div>

      {/* Format button + error */}
      <div className="flex items-center gap-hsp-md">
        <button
          type="button"
          onClick={handleFormat}
          disabled={isFormatting || !input.trim()}
          className="rounded-lg bg-accent px-hsp-xl py-hsp-xs text-caption font-semibold text-bg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isFormatting ? 'Formatting...' : 'Format'}
        </button>
        {error && (
          <span className="text-caption text-danger">{error}</span>
        )}
      </div>
    </div>
  );
}
