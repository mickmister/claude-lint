import { describe, it, expect } from 'vitest';
import { computeAdded, inRanges, matchesGlob, uniq } from './utils.js';
import type { Range } from './types.js';

describe('computeAdded', () => {
  it('should detect added lines', () => {
    const before = 'line1\nline2\nline3';
    const after = 'line1\nline2\nNEW LINE\nline3';

    const result = computeAdded(before, after);

    expect(result.ranges).toEqual([{ start: 3, end: 3 }]);
    expect(result.snippet).toBe('NEW LINE');
  });

  it('should detect multiple added ranges', () => {
    const before = 'line1\nline2\nline3';
    const after = 'line1\nADDED1\nline2\nADDED2\nADDED3\nline3';

    const result = computeAdded(before, after);

    expect(result.ranges).toEqual([
      { start: 2, end: 2 },
      { start: 4, end: 5 }
    ]);
    expect(result.snippet).toBe('ADDED1\nADDED2\nADDED3');
  });

  it('should handle empty before (new file)', () => {
    const before = '';
    const after = 'line1\nline2\nline3';

    const result = computeAdded(before, after);

    expect(result.ranges).toEqual([{ start: 1, end: 3 }]);
    expect(result.snippet).toBe('line1\nline2\nline3');
  });

  it('should handle no changes', () => {
    const before = 'line1\nline2';
    const after = 'line1\nline2';

    const result = computeAdded(before, after);

    expect(result.ranges).toEqual([]);
    expect(result.snippet).toBe('');
  });

  it('should handle deleted lines (no added ranges)', () => {
    const before = 'line1\nline2\nline3';
    const after = 'line1\nline3';

    const result = computeAdded(before, after);

    expect(result.ranges).toEqual([]);
    expect(result.snippet).toBe('');
  });
});

describe('inRanges', () => {
  it('should return true if line is in range', () => {
    const ranges: Range[] = [{ start: 5, end: 10 }];

    expect(inRanges(5, ranges)).toBe(true);
    expect(inRanges(7, ranges)).toBe(true);
    expect(inRanges(10, ranges)).toBe(true);
  });

  it('should return false if line is outside range', () => {
    const ranges: Range[] = [{ start: 5, end: 10 }];

    expect(inRanges(4, ranges)).toBe(false);
    expect(inRanges(11, ranges)).toBe(false);
  });

  it('should check multiple ranges', () => {
    const ranges: Range[] = [
      { start: 5, end: 10 },
      { start: 20, end: 25 }
    ];

    expect(inRanges(7, ranges)).toBe(true);
    expect(inRanges(22, ranges)).toBe(true);
    expect(inRanges(15, ranges)).toBe(false);
  });

  it('should return false for empty ranges', () => {
    expect(inRanges(5, [])).toBe(false);
  });
});

describe('matchesGlob', () => {
  it('should match simple glob patterns', () => {
    expect(matchesGlob('test.js', ['*.js'])).toBe(true);
    expect(matchesGlob('test.ts', ['*.js'])).toBe(false);
  });

  it('should match recursive glob patterns', () => {
    expect(matchesGlob('src/utils/test.js', ['**/*.js'])).toBe(true);
    expect(matchesGlob('deep/nested/path/file.ts', ['**/*.ts'])).toBe(true);
  });

  it('should match multiple extensions', () => {
    expect(matchesGlob('test.js', ['**/*.{js,ts}'])).toBe(true);
    expect(matchesGlob('test.ts', ['**/*.{js,ts}'])).toBe(true);
    expect(matchesGlob('test.jsx', ['**/*.{js,ts}'])).toBe(false);
  });

  it('should match any pattern in array', () => {
    const patterns = ['*.js', '*.ts', '*.jsx'];

    expect(matchesGlob('test.js', patterns)).toBe(true);
    expect(matchesGlob('test.ts', patterns)).toBe(true);
    expect(matchesGlob('test.jsx', patterns)).toBe(true);
    expect(matchesGlob('test.py', patterns)).toBe(false);
  });

  it('should be case-sensitive by default', () => {
    expect(matchesGlob('TEST.JS', ['*.js'])).toBe(false);
    expect(matchesGlob('test.js', ['*.js'])).toBe(true);
  });

  it('should handle case-insensitive patterns with [Xx] syntax', () => {
    expect(matchesGlob('README.md', ['**/*.[mM][dD]'])).toBe(true);
    expect(matchesGlob('readme.MD', ['**/*.[mM][dD]'])).toBe(true);
    expect(matchesGlob('notes.md', ['**/*.[mM][dD]'])).toBe(true);
  });
});

describe('uniq', () => {
  it('should remove duplicates', () => {
    expect(uniq([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
  });

  it('should preserve order', () => {
    expect(uniq([3, 1, 2, 1, 3])).toEqual([3, 1, 2]);
  });

  it('should handle strings', () => {
    expect(uniq(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('should handle empty array', () => {
    expect(uniq([])).toEqual([]);
  });
});
