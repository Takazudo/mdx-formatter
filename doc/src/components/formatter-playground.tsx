'use client';

import type { ComponentChildren, JSX } from 'preact';
import { useCallback, useState } from 'preact/hooks';

const DOC_BASE = '/pj/mdx-formatter/';

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

interface SettingToggle {
  enabled: boolean;
}

interface SettingsState {
  addEmptyLineBetweenElements: SettingToggle;
  formatMultiLineJsx: SettingToggle & { indentSize: number };
  expandSingleLineJsx: SettingToggle & { propsThreshold: number };
  indentJsxContent: SettingToggle & { containerComponents: string };
  addEmptyLinesInBlockJsx: SettingToggle & { blockComponents: string };
  formatYamlFrontmatter: SettingToggle;
  preserveAdmonitions: SettingToggle;
  autoDetectIndent: SettingToggle;
}

const TEXTAREA_CLASS =
  'min-h-[32rem] w-full resize-y rounded-lg border border-muted/30 bg-code-bg p-hsp-md font-mono text-caption leading-relaxed text-code-fg focus:border-accent focus:outline-none';

const defaultSettings: SettingsState = {
  addEmptyLineBetweenElements: { enabled: true },
  formatMultiLineJsx: { enabled: true, indentSize: 2 },
  expandSingleLineJsx: { enabled: false, propsThreshold: 2 },
  indentJsxContent: { enabled: false, containerComponents: '' },
  addEmptyLinesInBlockJsx: { enabled: true, blockComponents: '' },
  formatYamlFrontmatter: { enabled: true },
  preserveAdmonitions: { enabled: true },
  autoDetectIndent: { enabled: false },
};

interface WasmModule {
  default: (wasmUrl: string) => Promise<unknown>;
  format: (content: string, settingsJson: string | undefined) => string;
}

let wasmPromise: Promise<WasmModule> | null = null;

function loadWasm(): Promise<WasmModule> {
  if (wasmPromise) return wasmPromise;
  wasmPromise = (async () => {
    // Both files are copied into public/wasm by build:wasm:doc. Keep the
    // deployment base explicit: unlike HTML URLs, runtime import()/fetch URLs
    // are not passed through zfb's base-path rewriter.
    const wasmJsUrl = `${DOC_BASE}wasm/mdx_formatter_wasm.js`;
    const mod = (await import(/* @vite-ignore */ wasmJsUrl)) as WasmModule;
    await mod.default(`${DOC_BASE}wasm/mdx_formatter_wasm_bg.wasm`);
    return mod;
  })().catch((error: unknown) => {
    // Allow a later click to recover from a transient asset/network failure.
    wasmPromise = null;
    throw error;
  });
  return wasmPromise;
}

function buildFormatterSettings(s: SettingsState): Record<string, unknown> {
  return {
    addEmptyLineBetweenElements: { enabled: s.addEmptyLineBetweenElements.enabled },
    formatMultiLineJsx: {
      enabled: s.formatMultiLineJsx.enabled,
      indentSize: s.formatMultiLineJsx.indentSize,
    },
    expandSingleLineJsx: {
      enabled: s.expandSingleLineJsx.enabled,
      propsThreshold: s.expandSingleLineJsx.propsThreshold,
    },
    indentJsxContent: {
      enabled: s.indentJsxContent.enabled,
      containerComponents: s.indentJsxContent.containerComponents
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    },
    addEmptyLinesInBlockJsx: {
      enabled: s.addEmptyLinesInBlockJsx.enabled,
      blockComponents: s.addEmptyLinesInBlockJsx.blockComponents
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    },
    formatYamlFrontmatter: { enabled: s.formatYamlFrontmatter.enabled },
    preserveAdmonitions: { enabled: s.preserveAdmonitions.enabled },
    autoDetectIndent: { enabled: s.autoDetectIndent.enabled },
  };
}

function SettingRow({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  children?: ComponentChildren;
}) {
  return (
    <div className="flex flex-col gap-vsp-2xs">
      <label className="flex items-center gap-hsp-xs cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="accent-accent"
        />
        <span className="break-all text-caption font-mono text-fg">{label}</span>
      </label>
      {children && (
        <fieldset
          disabled={!enabled}
          className={`ml-5 flex min-w-0 flex-wrap items-center gap-hsp-xs ${!enabled ? 'opacity-40' : ''}`}
        >
          {children}
        </fieldset>
      )}
    </div>
  );
}

export default function FormatterPlayground(): JSX.Element {
  const [input, setInput] = useState(SAMPLE_INPUT);
  const [output, setOutput] = useState('');
  const [isFormatting, setIsFormatting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const updateSetting = useCallback(
    <K extends keyof SettingsState>(key: K, patch: Partial<SettingsState[K]>) => {
      setSettings((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    },
    [],
  );

  const handleFormat = useCallback(async () => {
    setIsFormatting(true);
    setError(null);
    try {
      const wasm = await loadWasm();
      const settingsJson = JSON.stringify(buildFormatterSettings(settings));
      const result = wasm.format(input, settingsJson);
      setOutput(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An unexpected error occurred');
    } finally {
      setIsFormatting(false);
    }
  }, [input, settings]);

  return (
    <div className="flex flex-col gap-vsp-sm">
      {/* Settings panel */}
      <div className="rounded-lg border border-muted/30 bg-surface">
        <button
          type="button"
          onClick={() => setSettingsOpen((prev) => !prev)}
          aria-expanded={settingsOpen}
          aria-controls="pg-settings"
          className="flex w-full items-center gap-hsp-xs p-hsp-md text-caption font-semibold text-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          <svg
            width="12"
            height="12"
            className={`shrink-0 transition-transform ${settingsOpen ? 'rotate-90' : ''}`}
            viewBox="0 0 12 12"
            fill="currentColor"
          >
            <path d="M4 2l4 4-4 4z" />
          </svg>
          Settings
        </button>
        {settingsOpen && (
          <div id="pg-settings" className="border-t border-muted/30 p-hsp-md flex flex-col gap-vsp-sm">
            <div className="grid grid-cols-1 gap-vsp-xs sm:grid-cols-2 sm:gap-hsp-md xl:grid-cols-3">
              <SettingRow
                label="addEmptyLineBetweenElements"
                enabled={settings.addEmptyLineBetweenElements.enabled}
                onToggle={() =>
                  updateSetting('addEmptyLineBetweenElements', {
                    enabled: !settings.addEmptyLineBetweenElements.enabled,
                  })
                }
              />

              <SettingRow
                label="formatMultiLineJsx"
                enabled={settings.formatMultiLineJsx.enabled}
                onToggle={() =>
                  updateSetting('formatMultiLineJsx', {
                    enabled: !settings.formatMultiLineJsx.enabled,
                  })
                }
              >
                <label className="text-caption text-muted">indentSize</label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={settings.formatMultiLineJsx.indentSize}
                  onInput={(e) =>
                    updateSetting('formatMultiLineJsx', {
                      indentSize: Math.max(1, Math.min(8, Number(e.currentTarget.value) || 2)),
                    })
                  }
                  className="w-14 rounded border border-muted/30 bg-code-bg px-hsp-xs py-0.5 text-caption text-fg"
                />
              </SettingRow>

              <SettingRow
                label="expandSingleLineJsx"
                enabled={settings.expandSingleLineJsx.enabled}
                onToggle={() =>
                  updateSetting('expandSingleLineJsx', {
                    enabled: !settings.expandSingleLineJsx.enabled,
                  })
                }
              >
                <label className="text-caption text-muted">propsThreshold</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={settings.expandSingleLineJsx.propsThreshold}
                  onInput={(e) =>
                    updateSetting('expandSingleLineJsx', {
                      propsThreshold: Math.max(1, Math.min(10, Number(e.currentTarget.value) || 2)),
                    })
                  }
                  className="w-14 rounded border border-muted/30 bg-code-bg px-hsp-xs py-0.5 text-caption text-fg"
                />
              </SettingRow>

              <SettingRow
                label="formatYamlFrontmatter"
                enabled={settings.formatYamlFrontmatter.enabled}
                onToggle={() =>
                  updateSetting('formatYamlFrontmatter', {
                    enabled: !settings.formatYamlFrontmatter.enabled,
                  })
                }
              />

              <SettingRow
                label="preserveAdmonitions"
                enabled={settings.preserveAdmonitions.enabled}
                onToggle={() =>
                  updateSetting('preserveAdmonitions', {
                    enabled: !settings.preserveAdmonitions.enabled,
                  })
                }
              />

              <SettingRow
                label="autoDetectIndent"
                enabled={settings.autoDetectIndent.enabled}
                onToggle={() =>
                  updateSetting('autoDetectIndent', {
                    enabled: !settings.autoDetectIndent.enabled,
                  })
                }
              />
            </div>

            {/* Text input settings — full width to avoid overlap */}
            <div className="flex flex-col gap-vsp-xs">
              <SettingRow
                label="indentJsxContent"
                enabled={settings.indentJsxContent.enabled}
                onToggle={() =>
                  updateSetting('indentJsxContent', {
                    enabled: !settings.indentJsxContent.enabled,
                  })
                }
              >
                <label className="text-caption text-muted shrink-0">containerComponents</label>
                <input
                  type="text"
                  value={settings.indentJsxContent.containerComponents}
                  onInput={(e) =>
                    updateSetting('indentJsxContent', {
                      containerComponents: e.currentTarget.value,
                    })
                  }
                  placeholder="Comp1, Comp2"
                  className="min-w-0 flex-1 rounded border border-muted/30 bg-code-bg px-hsp-xs py-0.5 text-caption text-fg placeholder:text-muted/50"
                />
              </SettingRow>

              <SettingRow
                label="addEmptyLinesInBlockJsx"
                enabled={settings.addEmptyLinesInBlockJsx.enabled}
                onToggle={() =>
                  updateSetting('addEmptyLinesInBlockJsx', {
                    enabled: !settings.addEmptyLinesInBlockJsx.enabled,
                  })
                }
              >
                <label className="text-caption text-muted shrink-0">blockComponents</label>
                <input
                  type="text"
                  value={settings.addEmptyLinesInBlockJsx.blockComponents}
                  onInput={(e) =>
                    updateSetting('addEmptyLinesInBlockJsx', {
                      blockComponents: e.currentTarget.value,
                    })
                  }
                  placeholder="Comp1, Comp2"
                  className="min-w-0 flex-1 rounded border border-muted/30 bg-code-bg px-hsp-xs py-0.5 text-caption text-fg placeholder:text-muted/50"
                />
              </SettingRow>
            </div>
          </div>
        )}
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
            onInput={(e) => setInput(e.currentTarget.value)}
            spellcheck={false}
            className={TEXTAREA_CLASS}
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
            spellcheck={false}
            className={TEXTAREA_CLASS}
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
          className="rounded-lg bg-accent px-hsp-xl py-hsp-xs text-caption font-semibold text-bg transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isFormatting ? 'Formatting...' : 'Format'}
        </button>
        {error && (
          <span role="alert" className="min-w-0 break-words text-caption text-danger">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

// zfb derives the SSR marker from displayName before the function name. Pin it
// so minification cannot desynchronise the marker from the island manifest.
FormatterPlayground.displayName = 'FormatterPlayground';
