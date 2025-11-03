# claude-lint

Give Claude custom actionable feedback for addressing unwanted development practices.

## Quick Start

```bash
npx claude-lint init
```

This sets up hooks in `.claude/settings.json` and uses the default rules.

To customize rules, add the `--customize` flag:

```bash
npx claude-lint init --customize
```

which will create `.claude/lint-config.mjs` where you can extend or override default validators.

## Default Rules (TypeScript-focused)

- No TODO/FIXME comments
- No explicit `any` types
- No manual package.json edits (use `npm install` instead)
- Markdown files in `claude_notes/NNN-name.md` (except CLAUDE.md/README.md)

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
pnpm test:ui       # UI mode
```

## License

MIT
