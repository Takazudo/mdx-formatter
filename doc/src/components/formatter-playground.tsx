import { type ReactNode, useCallback, useState } from 'react';
import { format } from '@takazudo/mdx-formatter/browser';
import type { DeepPartial, FormatterSettings } from '@takazudo/mdx-formatter/browser';

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

function buildFormatterSettings(s: SettingsState): DeepPartial<FormatterSettings> {
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
  children?: ReactNode;
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
        <span className="text-caption font-mono text-fg">{label}</span>
      </label>
      {children && (
        <fieldset disabled={!enabled} className={`ml-5 flex items-center gap-hsp-xs ${!enabled ? 'opacity-40' : ''}`}>
          {children}
        </fieldset>
      )}
    </div>
  );
}

export default function FormatterPlayground(): ReactNode {
  const [input, setInput] = useState(SAMPLE_INPUT);
  const [output, setOutput] = useState('');
  const [version, setVersion] = useState<Version>('typescript');
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
      const formatterSettings = buildFormatterSettings(settings);
      const result = await format(input, formatterSettings);
      setOutput(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An unexpected error occurred');
    } finally {
      setIsFormatting(false);
    }
  }, [input, settings]);

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
          <span className="group relative">
            <button
              type="button"
              disabled
              className="rounded px-hsp-md py-hsp-2xs text-caption font-medium bg-surface text-muted cursor-not-allowed opacity-50"
            >
              Rust (WASM)
            </button>
            <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-p0 px-hsp-sm py-hsp-2xs text-caption text-p7 opacity-0 group-hover:opacity-100 transition-opacity">
              Coming soon — requires WASM build
            </span>
          </span>
        </div>
      </div>

      {/* Settings panel */}
      <div className="rounded-lg border border-muted/30 bg-surface">
        <button
          type="button"
          onClick={() => setSettingsOpen((prev) => !prev)}
          aria-expanded={settingsOpen}
          aria-controls="pg-settings"
          className="flex w-full items-center gap-hsp-xs p-hsp-md text-caption font-semibold text-muted hover:text-fg transition-colors"
        >
          <svg
            className={`h-3 w-3 transition-transform ${settingsOpen ? 'rotate-90' : ''}`}
            viewBox="0 0 12 12"
            fill="currentColor"
          >
            <path d="M4 2l4 4-4 4z" />
          </svg>
          Settings
        </button>
        {settingsOpen && (
          <div id="pg-settings" className="border-t border-muted/30 p-hsp-md">
            <div className="grid grid-cols-1 gap-vsp-xs md:grid-cols-2 md:gap-hsp-md">
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
                  onChange={(e) =>
                    updateSetting('formatMultiLineJsx', {
                      indentSize: Math.max(1, Math.min(8, Number(e.target.value) || 2)),
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
                  onChange={(e) =>
                    updateSetting('expandSingleLineJsx', {
                      propsThreshold: Math.max(1, Math.min(10, Number(e.target.value) || 2)),
                    })
                  }
                  className="w-14 rounded border border-muted/30 bg-code-bg px-hsp-xs py-0.5 text-caption text-fg"
                />
              </SettingRow>

              <SettingRow
                label="indentJsxContent"
                enabled={settings.indentJsxContent.enabled}
                onToggle={() =>
                  updateSetting('indentJsxContent', {
                    enabled: !settings.indentJsxContent.enabled,
                  })
                }
              >
                <label className="text-caption text-muted">containerComponents</label>
                <input
                  type="text"
                  value={settings.indentJsxContent.containerComponents}
                  onChange={(e) =>
                    updateSetting('indentJsxContent', {
                      containerComponents: e.target.value,
                    })
                  }
                  placeholder="Comp1, Comp2"
                  className="w-36 rounded border border-muted/30 bg-code-bg px-hsp-xs py-0.5 text-caption text-fg placeholder:text-muted/50"
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
                <label className="text-caption text-muted">blockComponents</label>
                <input
                  type="text"
                  value={settings.addEmptyLinesInBlockJsx.blockComponents}
                  onChange={(e) =>
                    updateSetting('addEmptyLinesInBlockJsx', {
                      blockComponents: e.target.value,
                    })
                  }
                  placeholder="Comp1, Comp2"
                  className="w-36 rounded border border-muted/30 bg-code-bg px-hsp-xs py-0.5 text-caption text-fg placeholder:text-muted/50"
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
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
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
            spellCheck={false}
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
