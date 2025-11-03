import type { PresetFunction, LintMessage } from '../types.js';
import { matchesGlob } from '../utils.js';

export const filePatternValidator: PresetFunction = async (context) => {
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

    // Check each rule
    for (const rule of config.rules) {
      // Check if file matches any of the rule's patterns
      const matchesPattern = (rule.patterns || []).some(p =>
        matchesGlob(change.filePath, [p])
      );

      if (!matchesPattern) continue;

      // Check if file matches any allowed pattern
      const isAllowed = (rule.allowed || []).some(allowed => {
        // Try as glob first
        if (matchesGlob(change.filePath, [allowed])) {
          return true;
        }

        // Try as regex
        try {
          const regex = new RegExp(allowed);
          return regex.test(change.filePath);
        } catch {
          return false;
        }
      });

      if (!isAllowed) {
        messages.push({
          file: change.filePath,
          line: 1,
          column: 1,
          message: rule.message,
          ruleId: rule.name
        });
      }
    }
  }

  return {
    messages,
    errorCount: messages.length
  };
};
