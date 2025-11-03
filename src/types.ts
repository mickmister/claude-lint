/**
 * Shared types for the multi-validator architecture
 */

export interface Range {
  start: number;
  end: number;
}

export interface FileChange {
  filePath: string;
  before?: string;
  after: string;
  ranges: Range[];
  snippet: string;
  addedRanges?: Range[]; // Lines that are pure additions (no corresponding removal)
  modifiedRanges?: Range[]; // Lines that are modifications (paired with removals)
}

export interface LintMessage {
  file: string;
  line: number;
  column: number;
  message: string;
  ruleId: string;
}

export interface Rule {
  name: string;
  patterns?: string[];
  allowed?: string[];
  message: string;
  config?: any;
}

export interface ValidatorConfig {
  preset: string;
  scope: "changes-only" | "whole-file";
  files: string[];
  exclude?: string[];
  rules: Rule[];
  options?: Record<string, any>;
  changeType?: "added" | "modified" | "all"; // Filter by type of change (default: "all")
}

export interface LintConfig {
  validators: ValidatorConfig[];
  verbose: boolean;
  debug?: boolean;
}

export interface PresetResult {
  messages: LintMessage[];
  errorCount: number;
}

export interface PresetContext {
  changes: FileChange[];
  config: ValidatorConfig;
  sessionId: string;
  cwd: string;
}

export interface PresetFunction {
  (context: PresetContext): Promise<PresetResult>;
}

export interface SessionPaths {
  journal: string;
  precache: string;
  cache: string;
}

export class ExitCodeError extends Error {
  constructor(public code: number) {
    super(`Process would exit with code ${code}`);
    this.name = "ExitCodeError";
  }
}

/**
 * Helper function to define a lint config with type safety and autocomplete.
 * Use this in your config files for better IDE support.
 *
 * @example
 * ```typescript
 * import { defineLintConfig } from 'claude-lint';
 *
 * export default defineLintConfig({
 *   validators: [{
 *     preset: "regex",
 *     scope: "changes-only",
 *     files: ["**\/*.ts"],
 *     rules: [{
 *       name: "no-var",
 *       patterns: ["\\bvar\\s"],
 *       message: "Use const or let instead of var"
 *     }]
 *   }]
 * });
 * ```
 */
export function defineLintConfig(config: Partial<LintConfig> & { validators: ValidatorConfig[] }): LintConfig {
  return {
    verbose: false,
    debug: false,
    ...config
  };
}
