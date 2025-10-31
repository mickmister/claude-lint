# claude-lint-changes

A Claude Code-friendly CLI to journal changed files during Edit/Write events and lint them once at Stop using ESLint.
It implements a "snippet-first → fallback to full-file (filtered to changed lines)" strategy to keep TypeScript parsing robust.

## Features
- **Session isolation** - Automatically isolates caches between different Claude Code sessions to prevent confusion
- Journals changed files automatically via hooks
- Caches pre-edit versions for diffing
- Runs ESLint on only the lines that changed
- Falls back gracefully to lint full file if snippet fails parsing
- Can run fully without an `.eslintrc`, using inline rule definitions
- Verbose mode for debugging (`--verbose` flag)
- Automatic cleanup of journal and pre-cache with `--clear-journal`
- Automatic cleanup of cache folder after finalize completes
- Clear error logging and summary statistics
- **Custom rule guidance messages** - Show helpful context-specific guidance for each rule violation
- **eslint-plugin-no-comments** included - Control comment usage with configurable allowed patterns
- **Smart rule parsing** - Supports both simple (`rule:error`) and complex (`rule:["error",{options}]`) configurations
- **Proper exit codes** - Uses exit code 2 to block Stop hook and provide feedback to Claude when linting fails
- **Unit and integration tests** - Comprehensive test coverage with vitest

## Installation
pnpm install
pnpm dev -- help

## Subcommands
- **pre-cache** — store a "before" copy of the file (used in PreToolUse)
- **record** — append changed file to journal (used in PostToolUse)
- **finalize** — lint all changed files (used in Stop) and cleanup current session cache
- **clear** — clear the journal and caches for current session
- **clear-all** — clear ALL session caches (useful for cleaning up old test sessions)

## Session Management

Sessions are **automatically isolated** to prevent cache confusion when working on different features, branches, or in different Claude Code sessions.

### How it works:
1. **Environment variable** - If `CLAUDE_SESSION_ID` is set, it's used as the session ID
2. **Fallback** - Uses the process PID for automatic isolation
3. **Cache location** - All caches are stored in `.claude/cache/sessions/<session-id>/`

### For Claude Code:
Set the `CLAUDE_SESSION_ID` environment variable in your hooks to maintain consistent sessions:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "CLAUDE_SESSION_ID=$CLAUDE_SESSION npx claude-lint-changes pre-cache",
            "env": {"CLAUDE_SESSION_ID": "unique-session-id"}
          }
        ]
      }
    ]
  }
}
```

This ensures that:
- Different Claude Code sessions don't interfere with each other
- You can work on multiple features simultaneously without cache conflicts
- Cache is automatically cleaned up after each finalize

## Example hook wiring (.claude/settings.json)
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          { "type": "command", "command": "npx claude-lint-changes pre-cache" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          { "type": "command", "command": "npx claude-lint-changes record" }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "npx claude-lint-changes finalize --no-eslintrc --rules '@typescript-eslint/no-explicit-any:error,no-var:error' --type-aware --max-warnings 0 --clear-journal"
          }
        ]
      }
    ]
  }
}

## Example usage
pnpm dev help
npx claude-lint-changes record --file src/example.ts --verbose
npx claude-lint-changes pre-cache --file src/example.ts --verbose
npx claude-lint-changes finalize --no-eslintrc --rules '@typescript-eslint/no-explicit-any:error,no-var:error' --type-aware --max-warnings 0 --guidance rule-guidance.json --verbose
npx claude-lint-changes clear

## Rule Guidance
Create a `rule-guidance.json` file to provide helpful context when rules are violated:

```json
{
  "ruleOutputs": {
    "@typescript-eslint/no-explicit-any": "- Prefer natural type inference when possible.\n- If you're blocked, use the 'I'm blocked' MCP server to send me a message.",
    "no-var": "- Replace 'var' with 'const' for values that don't change, or 'let' for values that do.",
    "no-comments/disallowComments": "- If the comment is a TODO and you're blocked, use the 'I'm blocked' MCP server.\n- If the comment explains requirements, remove it.\n- If it truly increases readability, prefix with 'tip:'"
  }
}
```

Pass it via `--guidance rule-guidance.json` to see these messages in the output summary.

### Using eslint-plugin-no-comments
The `no-comments/disallowComments` rule is included. To configure it with allowed comment patterns, use the CSV rules format with JSON encoding:

```bash
--rules 'no-comments/disallowComments:["error",{"allow":["tip","eslint-disable"]}]'
```

Or use an `.eslintrc` file with full configuration support.

## Testing
```bash
pnpm test          # Run all tests once
pnpm test:watch    # Run tests in watch mode
pnpm test:ui       # Run tests with UI
```

## Local development
```bash
pnpm install
pnpm run build
pnpm dev -- help   # Run CLI locally
```

## Publish
npm publish --access public

## License
MIT
