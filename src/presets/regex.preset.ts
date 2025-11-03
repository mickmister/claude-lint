import type { PresetFunction, LintMessage } from '../types.js';
import { matchesGlob } from '../utils.js';

export const regexValidator: PresetFunction = async (context) => {
  const { changes, config } = context;
  const messages: LintMessage[] = [];

  for (const change of changes) {
    // Filter by files pattern
    if (!matchesGlob(change.filePath, config.files)) {
      continue;
    }

    // Filter by exclude pattern
    if (config.exclude && matchesGlob(change.filePath, config.exclude)) {
      continue;
    }

    // Choose content based on scope
    const content = config.scope === 'changes-only' ? change.snippet : change.after;
    const lines = content.split('\n');
    const lineOffset = config.scope === 'changes-only' && change.ranges.length > 0
      ? change.ranges[0].start - 1
      : 0;

    // Check each rule
    for (const rule of config.rules) {
      if (rule.severity === 'off') continue;
      if (!rule.patterns || rule.patterns.length === 0) continue;

      // Check each pattern
      for (const pattern of rule.patterns) {
        const regex = new RegExp(pattern, 'gm');

        // Check each line
        lines.forEach((line, idx) => {
          // Reset regex lastIndex for each line
          regex.lastIndex = 0;

          let match;
          while ((match = regex.exec(line)) !== null) {
            messages.push({
              file: change.filePath,
              line: lineOffset + idx + 1,
              column: (match.index ?? 0) + 1,
              message: rule.message,
              ruleId: rule.name,
              severity: rule.severity as 'error' | 'warning'
            });
          }
        });
      }
    }
  }

  return {
    messages,
    errorCount: messages.filter(m => m.severity === 'error').length,
    warningCount: messages.filter(m => m.severity === 'warning').length
  };
};
