# claude-lint

Give Claude custom actionable feedback for addressing unwanted development practices. Define what patterns you don't want to see in Claude's code output, and pair it up with specific instructions to address the issues.

## Installation

### Option 1: Claude Code Plugin (Recommended)

Install directly from the Claude Code plugin marketplace:

```bash
/plugin install mickmister/claude-lint
```

The plugin will automatically set up hooks in your `.claude/settings.json` with default configuration.

### Option 2: NPX Quick Start

```bash
npx claude-lint init
```

This sets up hooks in `.claude/settings.json` and uses the default rules.

To customize rules, add the `--customize` flag:

```bash
npx claude-lint init --customize
```

which will create `.claude/lint-config.mjs` where you can extend or override default validators.

## Global Configuration

You can configure `claude-lint` globally by running `init` in your home directory:

```bash
cd ~
npx claude-lint init
```

This adds hooks to `~/.claude/settings.json` that will run for all Claude Code sessions.

### Current Limitation

**At this time, global and project-level configurations cannot be used simultaneously on the same computer.** If you have global hooks configured, they will run for all projects, even those with their own `.claude/settings.json`.

You must choose one approach:
- **Global only**: Configure in `~/.claude/settings.json` for all projects
- **Per-project only**: Configure in each project's `.claude/settings.json`

### Future Enhancement

A future version will support automatic precedence handling where:
- Global config serves as a default for all projects
- Project-specific config automatically overrides global when present

This will allow you to set global defaults once and override per-project as needed.

## Uninstallation

### Plugin Installation

To uninstall the plugin:

```bash
/plugin uninstall claude-lint
```

This will remove the hooks from `.claude/settings.json` and clear the cache directory. Your custom configuration file (`.claude/lint-config.mjs`) will be preserved.

### NPX Installation

If you installed via NPX, manually remove the hooks from `.claude/settings.json` and delete the `.claude/lint-config.mjs` file if desired.

## Default Rules

The default configuration includes 4 validators focused on TypeScript development best practices:

### No Explicit `any` Types
Enforces proper TypeScript typing, and surfaces potentially unfinished code.

```javascript
{
  preset: "regex",
  scope: "changes-only",
  files: ["**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts,md}"],
  exclude: ["**/*-lint-config.js"],
  rules: [{
    name: "explicit-any",
    patterns: [
      ": any(?=[,\\s\\)\\}\\]\\|;]|$)",
      "as any(?=[,\\s\\)\\}\\]\\|;]|$)"
    ],
    message: `Explicit 'any' types are not allowed:
- Prefer natural type inference when possible
- Provide proper types or use 'unknown'.
- If you're blocked on the issue, please be super clear about this in your response.`
  }]
}
```

### No Manual package.json Edits
Ensures valid and up-to-date versions are used for new package installations.

```javascript
{
  preset: "regex",
  scope: "changes-only",
  files: ["**/package.json"],
  rules: [{
    name: "no-manual-package-json-deps",
    patterns: [
      "^\\s*\"[@a-zA-Z0-9._/-]+\"\\s*:\\s*\"[^\"]+\"\\s*,?\\s*$"
    ],
    message: `Do not manually add dependencies to package.json.

- Run: npm install <package> or pnpm add <package>
- For dev dependencies: npm install -D <package> or pnpm add -D <package>
- This ensures valid and up-to-date versions are used for new package installations.`
  }]
}
```

### No TODO Comments
Surfaces incomplete work for discussion.

```javascript
{
  preset: "regex",
  scope: "changes-only",
  files: ["**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts,md}"],
  exclude: ["**/*-lint-config.js"],
  rules: [{
    name: "no-todos",
    patterns: [
      "\\b[Tt][Oo][Dd][Oo]\\b",
      "\\b[Ff][Ii][Xx][Mm][Ee]\\b",
      "\\b[Hh][Aa][Cc][Kk]\\b"
    ],
    message: `TODO/FIXME/HACK comments not allowed:
- If you're blocked on the issue, please be super clear about this in your response.
- Otherwise please implement this here.`
  }]
}
```

### Markdown File Organization
Enforces consistent documentation structure.

```javascript
{
  preset: "file-pattern",
  scope: "whole-file",
  files: ["**/*.[mM][dD]"],
  rules: [{
    name: "markdown-organization",
    patterns: ["**/*.md", "**/*.MD"],
    allowed: [
      "**/CLAUDE.md",
      "**/CLAUDE.MD",
      "**/claude.md",
      "**/claude.MD",
      "**/README.md",
      "**/README.MD",
      "**/readme.md",
      "**/readme.MD",
      "claude_notes/*-*.md",
      "claude_notes/*-*.MD"
    ],
    message: `Markdown files (except CLAUDE.md/README.md) must be in claude_notes/ with numeric prefix.

- Move file to: claude_notes/NNN-descriptive-name.md
- Use format: claude_notes/001-feature-name.md, claude_notes/002-bug-fix.md, etc.
- Prefer mv over rewriting the whole file.`
  }]
}
```

## Available Presets for Customization

### `regex` - Pattern matching
```javascript
{
  preset: "regex",
  scope: "changes-only", // or "full-file"
  files: ["**/*.ts"],
  rules: [
    {
      name: "no-comments",
      patterns: [
        "^\\s*//(?!\\s*important:).*$",
        "^\\s*/\\*(?!.*important:).*\\*/$"
      ],
      message: "Comments not allowed (except 'important:' prefix)"
    }
  ]
}
```

### `file-pattern` - File organization
```javascript
{
  preset: "file-pattern",
  scope: "full-file",
  files: ["**/*.test.ts"],
  rules: [
    {
      name: "test-naming",
      pattern: "**/*.test.ts",
      allowed: false,
      message: "Use .spec.ts extension"
    }
  ]
}
```

## Custom Presets

Create custom validation logic by defining your own preset functions.

**my-preset.mjs:**
```javascript
import { definePresetFunction } from 'claude-lint';

export default definePresetFunction(async ({ changes, config, sessionId, cwd }) => {
  const messages = [];
  let errorCount = 0;

  for (const change of changes) {
    // Custom validation logic
    // Access: change.filePath, change.ranges, change.snippet, change.after

    // The regex preset should probably instead be used for this simple example, but this is just to show how to set up a custom preset.
    if (change.snippet.includes('forbidden-pattern')) {
      messages.push({
        file: change.filePath,
        line: change.ranges[0]?.start || 1,
        column: 1,
        message: "Forbidden pattern detected",
        ruleId: "custom-rule"
      });
      errorCount++;
    }
  }

  return { messages, errorCount };
});
```

**lint-config.mjs:**
```javascript
import { defineLintConfig } from 'claude-lint';

export default defineLintConfig({
  validators: [
    {
      preset: "./my-preset.mjs",
      scope: "changes-only",
      files: ["**/*.ts"],
      rules: []
    }
  ]
});
```

## Extending Default Config

You can extend the default validators by spreading them along with additional validators:

```javascript
import { defineLintConfig } from 'claude-lint';
import defaultConfig, {
  noCommentsValidator,
  noCommentsValidatorBash,
  noEmojisValidator
} from 'claude-lint/lint-config.default.mjs';

export default defineLintConfig({
  validators: [
    ...defaultConfig.validators,  // Include all default validators

    // Add optional validators with customization
    noCommentsValidator({ allowedKeywords: ['important:', 'NOTE:', 'TODO:'] }),
    noCommentsValidatorBash({ allowedKeywords: ['important:'] }),
    noEmojisValidator({ files: ['**/*.{ts,js,md}'] }),
  ],
  debug: true
});
```

### Available Validator Functions

All validators are factory functions that accept an `options` object for customization:

- `noTodosValidator(options)` - Disallows TODO/FIXME/HACK comments
  - `files`: File patterns (default: `**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts,md}`)
  - `exclude`: Exclude patterns
  - `message`: Custom error message

- `noExplicitAnyValidator(options)` - Disallows explicit `any` types
  - `files`: File patterns (default: `**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts,md}`)
  - `exclude`: Exclude patterns
  - `message`: Custom error message

- `noCommentsValidator(options)` - Disallows comments in JS/TS files
  - `allowedKeywords`: Array of allowed prefixes (default: `['important:']`)
  - `files`: File patterns (default: `**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts}`)
  - `message`: Custom error message

- `noCommentsValidatorBash(options)` - Disallows comments in shell scripts
  - `allowedKeywords`: Array of allowed prefixes (default: `['important:']`)
  - `files`: File patterns (default: `**/*.sh`, `**/*.bash`)
  - `message`: Custom error message

- `noEmojisValidator(options)` - Disallows emojis in code
  - `files`: File patterns (default: `**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts,md}`)
  - `message`: Custom error message

- `noManualPackageJsonValidator(options)` - Prevents manual package.json edits
  - `files`: File patterns (default: `**/package.json`)
  - `message`: Custom error message

- `markdownOrganizationValidator(options)` - Enforces markdown file organization
  - `files`: File patterns (default: `**/*.[mM][dD]`)
  - `allowed`: Array of allowed file patterns
  - `message`: Custom error message

## How It Works

`claude-lint` works with Claude Code's hook system to provide precise feedback when Claude finishes its work. This ensures you get consolidated feedback about all changes at once, rather than interrupting Claude during its work.

### Three-Phase Hook System

#### 1. PreToolUse Hook (Before Each Edit/Write)
Before Claude makes any file changes, the current file content is cached:

```
Claude starts editing → PreToolUse hook runs → File cached to .claude/.claude-lint/sessions/{session-id}/pre/
```

This creates a baseline snapshot of the file before changes are made.

#### 2. PostToolUse Hook (After Each Edit/Write)
After Claude completes an Edit or Write operation, the changed file path is journaled:

```
Claude finishes edit → PostToolUse hook runs → File path added to journal
```

The journal (`changed_files.txt`) keeps track of all files modified during the session. Multiple edits to the same file are deduplicated.

#### 3. Stop Hook (When Claude Finishes)
When Claude finishes its task, all changes are validated at once:

```
Claude finishes → Stop hook runs → Validates all journaled files
```

For each journaled file, `claude-lint`:
1. **Compares** the cached version with the current version using line-level diffing
2. **Identifies** exactly which lines were added or modified
3. **Runs validators** only on the changed lines (or full file, depending on `scope` config)
4. **Reports** violations with precise line numbers
5. **Cleans up** the session cache

### Precise Line-Level Feedback

The key advantage is **pinpoint accuracy**. Instead of linting entire files or giving vague feedback, `claude-lint`:

- Shows exact line and column numbers: `src/utils.ts:42:5`
- Reports only on lines Claude actually changed
- Consolidates all feedback into a single report when Claude finishes

### Example Workflow

```bash
# Claude starts editing files
PreToolUse:  Cache src/api.ts (baseline)
PostToolUse: Journal src/api.ts

PreToolUse:  Cache src/utils.ts (baseline)
PostToolUse: Journal src/utils.ts

PreToolUse:  src/api.ts already cached
PostToolUse: Journal src/api.ts (deduplicated)

# Claude finishes its task
Stop: Diff src/api.ts → lines 15-18 changed
Stop: Diff src/utils.ts → lines 42-45 changed
Stop: Validate changes → Report violations

Output:
src/api.ts:16:3  TODO/FIXME/HACK comments not allowed  (no-todos)
src/utils.ts:43:7  Explicit 'any' types are not allowed  (explicit-any)

Linted 2 files: 2 errors
To Claude: Please clean up 2 errors
```

### Session Isolation

Each conversation with Claude gets its own isolated session to prevent cache conflicts:
- Sessions are identified by `session_id` from Claude Code
- All caches stored in `.claude/.claude-lint/sessions/{session-id}/`
- Session cache automatically cleaned up after Stop hook completes

This means you can have multiple Claude Code windows open without cache interference.

## Manual Commands

```bash
npx claude-lint init                # Setup hooks (uses default config)
npx claude-lint init --customize    # Setup hooks and create config file for customization
npx claude-lint clear               # Clear current session
npx claude-lint clear-all           # Clear all sessions
npx claude-lint finalize --verbose  # Debug mode
```

## Testing

```bash
pnpm test          # Run all tests
pnpm test:watch    # Watch mode
```

## License

MIT
