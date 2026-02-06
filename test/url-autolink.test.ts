import { describe, it, expect } from 'vitest';
import { format } from '../src/index.js';
import { testSettings } from './test-helpers.js';

describe('URL Auto-linking Behavior', () => {
  describe('Standalone URLs', () => {
    it('should NOT wrap standalone URLs in angle brackets', async () => {
      const input = 'Check out https://example.com for more info.';
      const result = await format(input, { settings: testSettings });

      // URLs should remain as plain text, not wrapped in <>
      expect(result).not.toContain('<https://');
      expect(result).toContain('https://example.com');
    });

    it('should preserve spacing before URLs', async () => {
      const input = 'Visit https://example.com today.';
      const result = await format(input, { settings: testSettings });

      // Should have space before the URL
      expect(result).toContain('Visit https://example.com');
      expect(result).not.toContain('Visit<https://');
    });

    it('should handle multiple URLs without angle brackets', async () => {
      const input = 'Visit https://example.com and https://test.org for details.';
      const result = await format(input, { settings: testSettings });

      expect(result).not.toContain('<https://');
      expect(result).toContain('https://example.com');
      expect(result).toContain('https://test.org');
    });

    it('should handle URLs in lists without angle brackets', async () => {
      const input = `- Item 1
- Check https://example.com
- Item 3`;
      const result = await format(input, { settings: testSettings });

      expect(result).not.toContain('<https://');
      expect(result).toContain('https://example.com');
    });

    it('should handle URLs in mixed content', async () => {
      const input = `# Title

Visit https://example.com for more info.

## Resources
- https://resource1.com
- https://resource2.com`;

      const result = await format(input, { settings: testSettings });

      expect(result).not.toContain('<https://');
      expect(result).toContain('https://example.com');
      expect(result).toContain('https://resource1.com');
      expect(result).toContain('https://resource2.com');
    });
  });

  describe('Markdown Links', () => {
    it('should preserve markdown link syntax', async () => {
      const input = 'Check out [example](https://example.com) for more info.';
      const result = await format(input, { settings: testSettings });

      expect(result).toContain('[example](https://example.com)');
      expect(result).not.toContain('<https://');
    });

    it('should preserve spacing around markdown links', async () => {
      const input = 'Check out [example](https://example.com) for more info.';
      const result = await format(input, { settings: testSettings });

      expect(result).toContain('Check out [example](https://example.com)');
      expect(result).not.toContain('Check out[example]');
    });

    it('should handle mixed markdown links and plain URLs', async () => {
      const input = `Visit [our site](https://example.com) or go directly to https://test.org.`;
      const result = await format(input, { settings: testSettings });

      expect(result).toContain('[our site](https://example.com)');
      expect(result).toContain('https://test.org');
      expect(result).not.toContain('<https://');
    });
  });

  describe('Edge Cases', () => {
    it('should handle URLs with query parameters', async () => {
      const input = 'Search at https://example.com?q=test&page=1 for results.';
      const result = await format(input, { settings: testSettings });

      expect(result).not.toContain('<https://');
      expect(result).toContain('https://example.com?q=test&page=1');
    });

    it('should handle URLs with fragments', async () => {
      const input = 'Jump to https://example.com#section-2 directly.';
      const result = await format(input, { settings: testSettings });

      expect(result).not.toContain('<https://');
      expect(result).toContain('https://example.com#section-2');
    });

    it('should handle www URLs', async () => {
      const input = 'Visit www.example.com for more.';
      const result = await format(input, { settings: testSettings });

      // www URLs might still be auto-linked, but shouldn't have angle brackets
      expect(result).not.toContain('<www.');
    });

    it('should handle email addresses', async () => {
      const input = 'Contact us at test@example.com for help.';
      const result = await format(input, { settings: testSettings });

      // Email addresses might be auto-linked, but shouldn't have angle brackets
      expect(result).not.toContain('<test@');
    });
  });
});
