import { describe, it, expect } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { cursorInRange, EMPTY_LINK_RE } from './live-preview';

describe('cursorInRange', () => {
  it('returns true when cursor is inside the range', () => {
    const sel = EditorSelection.single(5);
    expect(cursorInRange(sel, 0, 10)).toBe(true);
  });

  it('returns false when cursor is before the range', () => {
    const sel = EditorSelection.single(0);
    expect(cursorInRange(sel, 5, 10)).toBe(false);
  });

  it('returns false when cursor is after the range', () => {
    const sel = EditorSelection.single(15);
    expect(cursorInRange(sel, 5, 10)).toBe(false);
  });

  it('returns true when cursor is at the start boundary', () => {
    const sel = EditorSelection.single(5);
    expect(cursorInRange(sel, 5, 10)).toBe(true);
  });

  it('returns true when cursor is at the end boundary', () => {
    const sel = EditorSelection.single(10);
    expect(cursorInRange(sel, 5, 10)).toBe(true);
  });

  it('returns true when any range in a multi-cursor selection is inside', () => {
    const sel = EditorSelection.create([EditorSelection.range(0, 0), EditorSelection.range(7, 7)]);
    expect(cursorInRange(sel, 5, 10)).toBe(true);
  });
});

describe('EMPTY_LINK_RE', () => {
  function matchUrl(input: string): string | null {
    EMPTY_LINK_RE.lastIndex = 0;
    const m = EMPTY_LINK_RE.exec(input);
    return m ? m[1] : null;
  }

  it('captures a simple URL', () => {
    expect(matchUrl('[](https://example.com/path)')).toBe('https://example.com/path');
  });

  it('captures a URL with balanced parentheses (Wikipedia)', () => {
    expect(matchUrl('[](https://en.wikipedia.org/wiki/Obsidian_(software))')).toBe(
      'https://en.wikipedia.org/wiki/Obsidian_(software)',
    );
  });

  it('captures a URL with parentheses mid-path', () => {
    expect(matchUrl('[](https://example.com/a(b)c)')).toBe('https://example.com/a(b)c');
  });

  it('returns null for non-http links', () => {
    expect(matchUrl('[](ftp://example.com)')).toBeNull();
  });

  it('returns null for links with display text', () => {
    expect(matchUrl('[click](https://example.com)')).toBeNull();
  });
});
