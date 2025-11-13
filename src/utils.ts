import { diffLines } from 'diff';
import { minimatch } from 'minimatch';
import type { Range } from './types.js';

export function computeAdded(before: string, after: string): {
  ranges: Range[],
  snippet: string,
  addedRanges: Range[],
  modifiedRanges: Range[]
} {
  const parts = diffLines(before, after);
  const ranges: Range[] = [];
  const addedRanges: Range[] = [];
  const modifiedRanges: Range[] = [];
  let afterLine = 1;
  const snippetPieces: string[] = [];
  let lastWasRemoval = false;

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const lines = p.value.split(/\r?\n/);
    const count = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;

    if (p.added) {
      const s = afterLine, e = afterLine + count - 1;
      if (count > 0) {
        ranges.push({ start: s, end: e });
        snippetPieces.push(p.value.replace(/\r?\n$/, ""));

        // If previous part was a removal, this is a modification
        // Otherwise, it's a pure addition
        if (lastWasRemoval) {
          modifiedRanges.push({ start: s, end: e });
        } else {
          addedRanges.push({ start: s, end: e });
        }
      }
      afterLine += count;
      lastWasRemoval = false;
    } else if (p.removed) {
      lastWasRemoval = true;
      // no advance
    } else {
      afterLine += count;
      lastWasRemoval = false;
    }
  }

  return { ranges, snippet: snippetPieces.join("\n"), addedRanges, modifiedRanges };
}

export function inRanges(line: number, ranges: Range[]): boolean {
  return ranges.some(r => line >= r.start && line <= r.end);
}

export function matchesGlob(file: string, patterns: string[]): boolean {
  return patterns.some(pattern => minimatch(file, pattern, { dot: true }));
}

export function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
