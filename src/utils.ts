import { diffLines } from 'diff';
import { minimatch } from 'minimatch';
import type { Range } from './types.js';

export function computeAdded(before: string, after: string): { ranges: Range[], snippet: string } {
  const parts = diffLines(before, after);
  const ranges: Range[] = [];
  let afterLine = 1;
  const snippetPieces: string[] = [];

  for (const p of parts) {
    const lines = p.value.split(/\r?\n/);
    const count = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;

    if (p.added) {
      const s = afterLine, e = afterLine + count - 1;
      if (count > 0) {
        ranges.push({ start: s, end: e });
        snippetPieces.push(p.value.replace(/\r?\n$/, ""));
      }
      afterLine += count;
    } else if (p.removed) {
      // no advance
    } else {
      afterLine += count;
    }
  }

  return { ranges, snippet: snippetPieces.join("\n") };
}

export function inRanges(line: number, ranges: Range[]): boolean {
  return ranges.some(r => line >= r.start && line <= r.end);
}

export function matchesGlob(file: string, patterns: string[]): boolean {
  return patterns.some(pattern => minimatch(file, pattern));
}

export function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
