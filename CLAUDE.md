# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`claude-lint` is a CLI tool designed specifically for Claude Code integration. It journals file changes during Edit/Write operations and runs ESLint only on changed lines during Stop events, implementing a "snippet-first → fallback to full-file (filtered to changed lines)" strategy.

## Development Commands

### Building and Running
```bash
pnpm install               # Install dependencies
pnpm run build             # Build TypeScript to dist/
pnpm dev -- <subcommand>   # Run CLI locally without building
```

### Testing
```bash
pnpm test                  # Run all tests once
pnpm test:watch            # Run tests in watch mode
pnpm test:ui               # Run tests with Vitest UI
```

### Running Individual Tests
```bash
pnpm test src/cli.test.ts            # Run specific test file
pnpm test -t "parseRulesCsv"         # Run tests matching name pattern
```

### Local Publishing (for testing)
```bash
# Start local npm registry (requires Docker)
cd verdaccio && docker-compose up -d

# Publish to local registry
pnpm publish:local
```

## Architecture Overview

### Core Workflow (Hook Integration)

The tool operates through three phases tied to Claude Code hooks:

1. **pre-cache** (PreToolUse hook): Before any Edit/Write, copies the current file to `.claude/cache/sessions/<session-id>/pre/{file}.bak`
2. **record** (PostToolUse hook): After Edit/Write completes, appends the changed file path to `.claude/cache/sessions/<session-id>/changed/changed_files.txt`
3. **finalize** (Stop hook): Reads the journal, diffs each file against its cached version, lints only changed lines, then cleans up the session cache

### Session Isolation

Sessions are automatically isolated to prevent cache conflicts:
- Reads `session_id` from stdin JSON payload (provided by Claude Code hooks)
- Falls back to "default" session if not in a hook context
- All caches stored in `.claude/cache/sessions/<session-id>/`
- Session cache automatically cleaned up after finalize completes

### Linting Strategy: Snippet-First with Fallback

The tool uses a sophisticated two-tier linting approach to balance speed and accuracy:

1. **Snippet-only lint** (preferred): Extracts only the added/changed lines using `diff`, attempts to lint just the snippet
   - Fast and isolated
   - Skips if parsing errors occur (incomplete syntax)

2. **Full-file lint with line filtering** (fallback): Lints the entire file, but only reports issues on lines within the changed ranges
   - Robust TypeScript parsing (full context available)
   - Filtered to show only new/changed violations

3. **New files** (no baseline): Lints entire file when no pre-cache exists

This strategy is critical for TypeScript projects where incomplete code snippets often fail to parse.

### Key Functions (src/cli.ts)

- **`getSessionId()`**: Reads session ID from stdin JSON payload or falls back to "default"
- **`parseArgs()`**: Custom CLI argument parser supporting `--flag value`, `--flag=value`, and boolean flags
- **`parseRulesCsv()`**: Parses complex rule configurations from CSV format, including JSON arrays/objects (e.g., `no-comments/disallowComments:["error",{"allow":["tip"]}]`)
- **`computeAdded()`**: Uses `diffLines` to find added/changed line ranges and extract snippets
- **`buildESLint()`**: Constructs ESLint instance with appropriate config (type-aware for TS, inline rules if `--no-eslintrc`)
- **`cmdFinalize()`**: Core linting logic implementing the snippet-first strategy

### Configuration System

The tool supports three levels of configuration (command-line flags override config file):

1. **Config file** (`.claude/lint-config.json`): JSON configuration for all options
2. **Command-line flags**: Override specific options (e.g., `--rules`, `--type-aware`, `--max-warnings`)
3. **Project ESLint config**: Used unless `--no-eslintrc` is set

### Rule Guidance Feature

The `ruleGuidance` configuration provides custom context-specific messages for rule violations. When violations are found, the tool displays:
- Violation counts sorted by frequency
- Custom guidance messages explaining how to fix or when to escalate
- Example: For `no-comments/disallowComments`, it can guide to use the "I'm blocked" MCP server for genuine blockers

## Configuration in This Repository

The repository uses its own hooks for development:
- `.claude/settings.json`: Hook configuration that calls `pnpm dev` commands
- `.claude/lint-config.json`: Lint rules including `no-comments/disallowComments` with allowed patterns (`tip`, `eslint-disable`)

## Testing Approach

Tests use Vitest with unit tests for individual functions:
- **Parsing tests**: `parseArgs()`, `parseRulesCsv()` - verify CLI arg parsing and complex rule configs
- **Utility tests**: `isWebFile()`, `virtFromReal()`, `uniq()` - helper functions
- **Diff logic tests**: `computeAdded()`, `inRanges()` - core diffing and line range matching

Integration tests exist in `src/integration.test.ts` for end-to-end hook workflows.

## File Type Support

Only web files are processed (filtered by `isWebFile()`):
- JavaScript: `.js`, `.jsx`
- TypeScript: `.ts`, `.tsx`

Virtual file names for snippet linting are determined by extension to ensure proper parser selection.

## TypeScript Configuration

The project uses modern TypeScript settings:
- Target: ES2022
- Module system: NodeNext (ESM)
- Strict mode enabled
- Output to `dist/`

The CLI uses `createRequire` for CommonJS compatibility when loading ESLint plugins dynamically.

## Exit Codes

- `0`: Success (no errors, warnings within threshold)
- `1`: Uncaught error or exception
- `2`: Lint errors found OR warnings exceed `--max-warnings` threshold

Exit code 2 is specifically used to block the Stop hook and provide feedback to Claude when linting fails.
