import { describe, it, expect } from 'vitest';
import { format } from '../src/index.js';
import type { DeepPartial, FormatterSettings } from '../src/types.js';

/**
 * Tests for single-pass idempotency (issue #14).
 *
 * The formatter should produce stable output after a single format() call.
 * Previously, some inputs required two passes to converge because rule
 * interactions (e.g. list indent normalization + addEmptyLinesInBlockJsx)
 * meant the first pass's output still had formatting changes on re-check.
 */
describe('Idempotency — single-pass convergence', () => {
  const settingsWithBlockComponents: DeepPartial<FormatterSettings> = {
    addEmptyLinesInBlockJsx: {
      blockComponents: ['Note', 'InfoBox', 'Outro', 'Warning'],
    },
  };

  it('should be idempotent: format(format(x)) === format(x)', async () => {
    const input = `<Note>
  - List item with 2-space indent
  - Another item
</Note>`;

    const firstPass = await format(input, { settings: settingsWithBlockComponents });
    const secondPass = await format(firstPass, { settings: settingsWithBlockComponents });

    expect(firstPass).toBe(secondPass);
  });

  it('should converge list-inside-block-JSX in one format() call', async () => {
    // This input triggers two rules that interact:
    // 1. List indentation normalization removes the 2-space indent
    // 2. addEmptyLinesInBlockJsx adds empty lines after opening / before closing tag
    // Previously, these didn't converge in a single pass.
    const input = `<Note>
  - List item with 2-space indent
  - Another item
</Note>`;

    const result = await format(input, { settings: settingsWithBlockComponents });

    // The result should have both: normalized indentation AND empty lines
    expect(result).toContain('<Note>\n\n');
    expect(result).toContain('\n\n</Note>');
    expect(result).toContain('- List item');
    expect(result).toContain('- Another item');

    // And it must be stable — formatting again produces identical output
    const reformat = await format(result, { settings: settingsWithBlockComponents });
    expect(reformat).toBe(result);
  });

  it('should converge nested block JSX with lists in one pass', async () => {
    const input = `<InfoBox>
  - First item
  - Second item
  - Third item
</InfoBox>`;

    const result = await format(input, {
      settings: settingsWithBlockComponents,
    });
    const reformat = await format(result, {
      settings: settingsWithBlockComponents,
    });

    expect(result).toBe(reformat);
  });

  it('should converge block JSX with mixed content in one pass', async () => {
    const input = `<Warning>
  Some paragraph text inside the warning.

  - A list item
  - Another list item
</Warning>`;

    const result = await format(input, {
      settings: settingsWithBlockComponents,
    });
    const reformat = await format(result, {
      settings: settingsWithBlockComponents,
    });

    expect(result).toBe(reformat);
  });

  it('should still be idempotent for already-formatted content', async () => {
    const input = `<Note>

- List item
- Another item

</Note>`;

    const result = await format(input, { settings: settingsWithBlockComponents });
    expect(result).toBe(input);
  });

  it('should converge in the Rust engine convergence loop', async () => {
    // The Rust engine runs its own convergence loop internally (up to 3 iterations).
    // Verify that format(format(x)) === format(x) for edge cases.
    const input = `<Note>
  - List item with 2-space indent
  - Another item
</Note>`;

    const pass1 = await format(input, { settings: settingsWithBlockComponents });
    const pass2 = await format(pass1, { settings: settingsWithBlockComponents });
    expect(pass2).toBe(pass1);
  });
});
