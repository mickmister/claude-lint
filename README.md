# claude-lint

**Lint only what Claude Code changes.** Validates code changes as you work, blocking Claude when errors are found.

## Quick Start

```bash
npx claude-lint init
```

This creates:
- `.claude/settings.json` - Hooks configuration
- `.claude/lint-config.mjs` - Lint config (extends defaults)

## Default Rules (TypeScript-focused)

- 🚫 No TODO/FIXME/HACK comments
- 🚫 No explicit `any` types
- 📦 No manual package.json edits (use `npm install` instead)
- 📝 Markdown files in `claude_notes/NNN-name.md` (except CLAUDE.md/README.md)

Customize by editing `.claude/lint-config.mjs` (created by `init`).

## Built-in Presets

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

**my-preset.mjs:**
```javascript
export default async function({ changes, config, sessionId, cwd }) {
  const messages = [];
  let errorCount = 0;

  for (const change of changes) {
    // Validate change.filePath, change.ranges, change.snippet, change.after
  }

  return { messages, errorCount, warningCount: 0 };
}
```

**lint-config.mjs:**
```javascript
export default defineLintConfig({
  validators: [{ preset: "./my-preset.mjs", scope: "changes-only", files: ["**/*.ts"] }]
});
```

## Manual Commands

```bash
npx claude-lint init              # Setup hooks
npx claude-lint clear             # Clear current session
npx claude-lint clear-all         # Clear all sessions
npx claude-lint finalize --verbose # Debug mode
```

## Testing

```bash
pnpm test          # Run all tests
pnpm test:watch    # Watch mode
pnpm test:ui       # UI mode
```

## License

MIT
