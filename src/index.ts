/**
 * claude-lint - Multi-validator linting tool for Claude Code
 *
 * This file exports the public API for use in config files.
 */

export {
  defineLintConfig,
  definePresetFunction,
  type LintConfig,
  type ValidatorConfig,
  type Rule,
  type PresetFunction,
  type PresetContext,
  type PresetResult,
  type FileChange,
  type LintMessage,
  type Range
} from './types.js';
