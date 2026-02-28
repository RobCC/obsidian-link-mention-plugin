import { describe, it, expect } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { cursorInRange } from './live-preview';

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
