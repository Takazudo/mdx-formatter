import { describe, expect, it } from 'vitest';
import { getLegacyRedirect } from '../worker/index.js';

describe('legacy documentation redirects', () => {
  it('redirects the old root path to the new origin', () => {
    expect(getLegacyRedirect('https://takazudomodular.com/pj/mdx-formatter/')).toBe(
      'https://mdx-formatter.takazudomodular.com/',
    );
  });

  it('preserves nested paths and query parameters', () => {
    expect(
      getLegacyRedirect('https://takazudomodular.com/pj/mdx-formatter/docs/overview?lang=en'),
    ).toBe('https://mdx-formatter.takazudomodular.com/docs/overview?lang=en');
  });

  it('redirects the legacy path when requested on the new hostname', () => {
    expect(
      getLegacyRedirect('https://mdx-formatter.takazudomodular.com/pj/mdx-formatter/docs/options'),
    ).toBe('https://mdx-formatter.takazudomodular.com/docs/options');
  });

  it('leaves unrelated paths and hosts unchanged', () => {
    expect(getLegacyRedirect('https://takazudomodular.com/pj/other/')).toBeNull();
    expect(getLegacyRedirect('https://example.com/pj/mdx-formatter/')).toBeNull();
  });
});
