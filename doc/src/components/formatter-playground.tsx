'use client';

import { computed, getScope, Show, signal } from '@takazudo/zfb/zudo-react';
import type { Child, Signal } from '@takazudo/zfb/zudo-react';
import { DOC_BASE } from './formatter-playground-config';

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

interface SettingsValues {
  addEmptyLineBetweenElements: boolean;
  formatMultiLineJsx: boolean;
  indentSize: number;
  expandSingleLineJsx: boolean;
  propsThreshold: number;
  indentJsxContent: boolean;
  containerComponents: string;
  addEmptyLinesInBlockJsx: boolean;
  blockComponents: string;
  formatYamlFrontmatter: boolean;
  preserveAdmonitions: boolean;
  autoDetectIndent: boolean;
}

const TEXTAREA_CLASS =
  'fp-control min-h-[32rem] w-full resize-y rounded-lg border bg-code-bg p-hsp-md font-mono text-caption leading-relaxed text-code-fg placeholder:text-muted focus:border-accent focus:outline-none';

interface WasmModule {
  default: (options: { module_or_path: string }) => Promise<unknown>;
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
    await mod.default({
      module_or_path: `${DOC_BASE}wasm/mdx_formatter_wasm_bg.wasm`,
    });
    return mod;
  })().catch((error: unknown) => {
    // Allow a later click to recover from a transient asset/network failure.
    wasmPromise = null;
    throw error;
  });
  return wasmPromise;
}

function splitComponents(value: string): string[] {
  return value
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

function buildFormatterSettings(s: SettingsValues): Record<string, unknown> {
  return {
    addEmptyLineBetweenElements: { enabled: s.addEmptyLineBetweenElements },
    formatMultiLineJsx: { enabled: s.formatMultiLineJsx, indentSize: s.indentSize },
    expandSingleLineJsx: { enabled: s.expandSingleLineJsx, propsThreshold: s.propsThreshold },
    indentJsxContent: {
      enabled: s.indentJsxContent,
      containerComponents: splitComponents(s.containerComponents),
    },
    addEmptyLinesInBlockJsx: {
      enabled: s.addEmptyLinesInBlockJsx,
      blockComponents: splitComponents(s.blockComponents),
    },
    formatYamlFrontmatter: { enabled: s.formatYamlFrontmatter },
    preserveAdmonitions: { enabled: s.preserveAdmonitions },
    autoDetectIndent: { enabled: s.autoDetectIndent },
  };
}

function clampSetting(raw: string, min: number, max: number, fallback: number): number {
  const value = Number(raw) || fallback;
  return Math.max(min, Math.min(max, value));
}

function SettingRow({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: Signal<boolean>;
  children?: Child;
}) {
  return (
    <div class="flex flex-col gap-vsp-2xs">
      <label class="flex items-center gap-hsp-xs cursor-pointer select-none">
        <input type="checkbox" modelChecked={enabled} class="accent-accent" />
        <span class="break-all text-caption font-mono text-fg">{label}</span>
      </label>
      {children === undefined ? null : (
        <fieldset
          disabled={computed(() => !enabled.value)}
          class={computed(
            () =>
              `fp-setting-detail flex min-w-0 flex-wrap items-center gap-hsp-xs ${enabled.value ? '' : 'opacity-40'}`,
          )}
        >
          {children}
        </fieldset>
      )}
    </div>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  fallback,
}: {
  label: string;
  value: Signal<number>;
  min: number;
  max: number;
  fallback: number;
}) {
  return (
    <label class="flex items-center gap-hsp-xs text-caption text-muted">
      {label}
      <input
        type="number"
        min={String(min)}
        max={String(max)}
        // Numeric inputs have no model adapter; read the signal when the
        // control is created and write clamped edits back to the DOM.
        value={value.value}
        on:input={(event) => {
          const next = clampSetting(event.currentTarget.value, min, max, fallback);
          value.value = next;
          // Leave an emptied field alone so the user can type a replacement;
          // the fallback still applies to formatting meanwhile.
          if (event.currentTarget.value !== '' && event.currentTarget.value !== String(next)) {
            event.currentTarget.value = String(next);
          }
        }}
        class="fp-number-input fp-control rounded border bg-code-bg px-hsp-xs py-hsp-2xs text-caption text-fg focus:border-accent focus:outline-none"
      />
    </label>
  );
}

function TextSetting({ label, value }: { label: string; value: Signal<string> }) {
  return (
    <label class="flex min-w-0 flex-1 items-center gap-hsp-xs text-caption text-muted">
      <span class="shrink-0">{label}</span>
      <input
        type="text"
        modelValue={value}
        placeholder="Comp1, Comp2"
        class="min-w-0 flex-1 placeholder:text-muted fp-control rounded border bg-code-bg px-hsp-xs py-hsp-2xs text-caption text-fg focus:border-accent focus:outline-none"
      />
    </label>
  );
}

export default function FormatterPlayground() {
  const scope = getScope();

  const input = signal(SAMPLE_INPUT);
  const output = signal('');
  const isFormatting = signal(false);
  const error = signal<string | null>(null);
  const settingsOpen = signal(false);

  const addEmptyLineBetweenElements = signal(true);
  const formatMultiLineJsx = signal(true);
  const indentSize = signal(2);
  const expandSingleLineJsx = signal(false);
  const propsThreshold = signal(2);
  const indentJsxContent = signal(false);
  const containerComponents = signal('');
  const addEmptyLinesInBlockJsx = signal(true);
  const blockComponents = signal('');
  const formatYamlFrontmatter = signal(true);
  const preserveAdmonitions = signal(true);
  const autoDetectIndent = signal(false);

  const formatDisabled = computed(() => isFormatting.value || input.value.trim() === '');
  const formatLabel = computed(() => (isFormatting.value ? 'Formatting...' : 'Format'));
  const hasError = computed(() => error.value !== null);
  const errorText = computed(() => error.value ?? '');
  const chevronClass = computed(
    () => `shrink-0 transition-transform ${settingsOpen.value ? 'rotate-90' : ''}`,
  );

  let run = 0;

  async function handleFormat() {
    const current = ++run;
    const isCurrent = () => !scope.abortSignal.aborted && current === run;
    isFormatting.value = true;
    error.value = null;
    try {
      const wasm = await loadWasm();
      if (!isCurrent()) return;
      const settingsJson = JSON.stringify(
        buildFormatterSettings({
          addEmptyLineBetweenElements: addEmptyLineBetweenElements.value,
          formatMultiLineJsx: formatMultiLineJsx.value,
          indentSize: indentSize.value,
          expandSingleLineJsx: expandSingleLineJsx.value,
          propsThreshold: propsThreshold.value,
          indentJsxContent: indentJsxContent.value,
          containerComponents: containerComponents.value,
          addEmptyLinesInBlockJsx: addEmptyLinesInBlockJsx.value,
          blockComponents: blockComponents.value,
          formatYamlFrontmatter: formatYamlFrontmatter.value,
          preserveAdmonitions: preserveAdmonitions.value,
          autoDetectIndent: autoDetectIndent.value,
        }),
      );
      output.value = wasm.format(input.value, settingsJson);
    } catch (e) {
      if (isCurrent()) {
        error.value = e instanceof Error ? e.message : 'An unexpected error occurred';
      }
    } finally {
      if (isCurrent()) isFormatting.value = false;
    }
  }

  return (
    <div class="flex flex-col gap-vsp-sm">
      {/* Settings panel */}
      <div class="fp-line rounded-lg border bg-surface">
        <button
          type="button"
          on:click={() => {
            settingsOpen.value = !settingsOpen.value;
          }}
          aria-expanded={settingsOpen}
          aria-controls="pg-settings"
          class="flex w-full items-center gap-hsp-xs p-hsp-md text-caption font-semibold text-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          <svg width="12" height="12" class={chevronClass} viewBox="0 0 12 12" fill="currentColor">
            <path d="M4 2l4 4-4 4z" />
          </svg>
          Settings
        </button>
        <Show when={settingsOpen}>
          {() => (
            <div id="pg-settings" class="fp-line border-t p-hsp-md flex flex-col gap-vsp-sm">
              <div class="grid grid-cols-1 gap-vsp-xs sm:grid-cols-2 sm:gap-hsp-md xl:grid-cols-3">
                <SettingRow
                  label="addEmptyLineBetweenElements"
                  enabled={addEmptyLineBetweenElements}
                />
                <SettingRow label="formatMultiLineJsx" enabled={formatMultiLineJsx}>
                  <NumberSetting label="indentSize" value={indentSize} min={1} max={8} fallback={2} />
                </SettingRow>
                <SettingRow label="expandSingleLineJsx" enabled={expandSingleLineJsx}>
                  <NumberSetting
                    label="propsThreshold"
                    value={propsThreshold}
                    min={1}
                    max={10}
                    fallback={2}
                  />
                </SettingRow>
                <SettingRow label="formatYamlFrontmatter" enabled={formatYamlFrontmatter} />
                <SettingRow label="preserveAdmonitions" enabled={preserveAdmonitions} />
                <SettingRow label="autoDetectIndent" enabled={autoDetectIndent} />
              </div>

              {/* Text input settings — full width to avoid overlap */}
              <div class="flex flex-col gap-vsp-xs">
                <SettingRow label="indentJsxContent" enabled={indentJsxContent}>
                  <TextSetting label="containerComponents" value={containerComponents} />
                </SettingRow>
                <SettingRow label="addEmptyLinesInBlockJsx" enabled={addEmptyLinesInBlockJsx}>
                  <TextSetting label="blockComponents" value={blockComponents} />
                </SettingRow>
              </div>
            </div>
          )}
        </Show>
      </div>

      {/* Textareas */}
      <div class="grid grid-cols-1 gap-hsp-md lg:grid-cols-2">
        <div class="flex flex-col gap-vsp-2xs">
          <label for="pg-input" class="text-caption font-semibold text-muted">
            Input
          </label>
          <textarea id="pg-input" modelValue={input} spellcheck={false} class={TEXTAREA_CLASS} />
        </div>
        <div class="flex flex-col gap-vsp-2xs">
          <label for="pg-output" class="text-caption font-semibold text-muted">
            Output
          </label>
          <textarea
            id="pg-output"
            value={output}
            readonly={true}
            spellcheck={false}
            class={TEXTAREA_CLASS}
            placeholder="Click Format to see the result..."
          />
        </div>
      </div>

      {/* Format button + error */}
      <div class="flex items-center gap-hsp-md">
        <button
          type="button"
          on:click={handleFormat}
          disabled={formatDisabled}
          class="rounded-lg bg-accent px-hsp-xl py-hsp-xs text-caption font-semibold text-bg transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {formatLabel}
        </button>
        <Show when={hasError}>
          {() => (
            <span role="alert" class="min-w-0 break-words text-caption text-danger">
              {errorText}
            </span>
          )}
        </Show>
      </div>
    </div>
  );
}
